import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { computeAndLogDiscipline } from '@/lib/discipline';
import { notifyCheckinWhatsapp, notifyCheckoutWhatsapp } from '@/lib/attendance-whatsapp';

export type AttendanceStatus = 'active' | 'on_break' | 'completed';

export interface AttendanceSession {
  id: string;
  user_id: string;
  staff_id: string | null;
  work_date: string;
  check_in_at: string;
  check_in_photo_url: string;
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_accuracy: number | null;
  check_out_at: string | null;
  check_out_photo_url: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_accuracy: number | null;
  total_break_minutes: number;
  worked_minutes: number | null;
  status: AttendanceStatus;
  late_checkout: boolean;
  created_at: string;
  updated_at: string;
  overtime_reminder_sent?: boolean;
  auto_closed?: boolean;
  /** Added by an owner/admin instead of a real check-in. */
  is_manual?: boolean;
  edited_by_name?: string | null;
  edited_at?: string | null;
  edit_reason?: string | null;
}

export interface AttendanceBreak {
  id: string;
  session_id: string;
  start_at: string;
  end_at: string | null;
  duration_minutes: number | null;
}

export interface CapturePayload {
  photoBlob: Blob;
  lat: number;
  lng: number;
  accuracy: number;
}

const BUCKET = 'attendance-photos';

function isTransientAttendanceError(error: unknown): boolean {
  const value = error && typeof error === 'object' ? error as { message?: string; status?: number; statusCode?: number } : {};
  const status = Number(value.status ?? value.statusCode);
  return status === 408 || status === 429 || status >= 500 || /failed to fetch|network|load failed|timeout|timed out/i.test(value.message ?? String(error));
}

/** Retry only reads and fresh-path uploads, never blindly repeat an attendance write. */
async function retryAttendanceRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (error) {
    if (!isTransientAttendanceError(error)) throw error;
    await new Promise(resolve => setTimeout(resolve, 500));
    return read();
  }
}

async function getSessionById(userId: string, sessionId: string): Promise<AttendanceSession | null> {
  return retryAttendanceRead(async () => {
    const { data, error } = await supabase.from('attendance_sessions' as never)
      .select('*').eq('user_id', userId).eq('id', sessionId).maybeSingle();
    if (error) throw error;
    return data as AttendanceSession | null;
  });
}

/** SDK failures may be plain objects rather than JavaScript Error instances. */
export function attendanceErrorMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : typeof error === 'string' ? error : '';
  if (/jwt|token.*expired|not authenticated|session.*expired/i.test(message)) {
    return 'Your sign-in has expired. Sign in again, then retry your attendance.';
  }
  if (/failed to fetch|network|load failed|timeout|timed out/i.test(message)) {
    return 'The connection was interrupted. Check your internet and retry; your attendance will be checked before saving.';
  }
  return message || 'Could not save attendance. Please retry or contact your manager.';
}

export function localDateString(d: Date = new Date()): string {
  // YYYY-MM-DD in local timezone
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

async function uploadPhoto(userId: string, sessionId: string, kind: 'checkin' | 'checkout', blob: Blob): Promise<string> {
  return retryAttendanceRead(async () => {
    const path = `${userId}/${sessionId}/${kind}-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (error) throw error;
    return path;
  }).catch(error => {
    throw new Error(`Photo could not be saved. ${attendanceErrorMessage(error)}`);
  });
}

export async function getCurrentSession(userId: string): Promise<AttendanceSession | null> {
  return retryAttendanceRead(async () => {
  const { data, error } = await supabase
    .from('attendance_sessions' as never)
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'on_break'])
    .order('check_in_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AttendanceSession | null) ?? null;
  });
}

/**
 * How long a finished shift keeps showing as "Shift completed" after check-out. Long enough to
 * cover a night shift ending after midnight, short enough that the next day's shift (typically
 * 14-15h after the last check-out) gets the big Check In button again.
 */
const RECENT_COMPLETED_HOURS = 12;

/**
 * The latest completed session checked out within the last 12 hours. Uses check-out time,
 * not work_date, so a night shift that ended after midnight still shows as completed.
 */
export async function getRecentCompletedSession(userId: string): Promise<AttendanceSession | null> {
  const since = new Date(Date.now() - RECENT_COMPLETED_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('attendance_sessions' as never)
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gte('check_out_at', since)
    .order('check_out_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AttendanceSession | null) ?? null;
}

export async function getSessionBreaks(sessionId: string): Promise<AttendanceBreak[]> {
  const { data, error } = await supabase
    .from('attendance_breaks' as never)
    .select('*')
    .eq('session_id', sessionId)
    .order('start_at', { ascending: true });
  if (error) throw error;
  return (data as AttendanceBreak[]) ?? [];
}

/** Thrown by checkIn when the user already has an open session (unique index violation). */
export class AlreadyCheckedInError extends Error {
  constructor() {
    super('You are already checked in');
    this.name = 'AlreadyCheckedInError';
  }
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Older Android WebViews: RFC 4122 v4 from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function checkIn(
  userId: string,
  staffId: string | null,
  payload: CapturePayload,
): Promise<AttendanceSession> {
  // Re-check the server before uploading: the card may be stale on another device.
  const existing = await getCurrentSession(userId);
  if (existing) throw new AlreadyCheckedInError();
  // Upload the selfie first, into a folder named after a client-generated session id, then
  // create the row with the real photo path in one insert. A failed or slow upload therefore
  // never leaves an open session behind that would block the next attempt.
  const sessionId = newSessionId();
  const capturedAt = new Date();
  const path = await uploadPhoto(userId, sessionId, 'checkin', payload.photoBlob);
  let inserted: unknown;
  let insertErr: unknown;
  try {
  const response = await supabase
    .from('attendance_sessions' as never)
    .insert({
      id: sessionId,
      user_id: userId,
      staff_id: staffId,
      work_date: localDateString(capturedAt),
      check_in_at: capturedAt.toISOString(),
      check_in_photo_url: path,
      check_in_lat: payload.lat,
      check_in_lng: payload.lng,
      check_in_accuracy: payload.accuracy,
      status: 'active',
    } as never)
    .select('*')
    .single();
    inserted = response.data;
    insertErr = response.error;
  } catch (error) { insertErr = error; }
  if (insertErr) {
    // A lost response does not mean a failed save. Read the exact attempted ID first.
    const saved = await getSessionById(userId, sessionId).catch(() => null);
    if (saved) inserted = saved;
    else {
    // attendance_sessions_one_open_per_user: a session is already open for this user.
    if ((insertErr as { code?: string }).code === '23505') throw new AlreadyCheckedInError();
    throw new Error(`Check-in could not be saved. ${attendanceErrorMessage(insertErr)}`);
    }
  }
  const result = inserted as AttendanceSession;
  if (result.staff_id) {
    notifyCheckinWhatsapp(result.staff_id, result.check_in_at, result.work_date);
  }
  return result;
}

export async function startBreak(sessionId: string): Promise<void> {
  const { error: insErr } = await supabase
    .from('attendance_breaks' as never)
    .insert({ session_id: sessionId, start_at: new Date().toISOString() } as never);
  if (insErr) throw insErr;
  const { error: updErr } = await supabase
    .from('attendance_sessions' as never)
    .update({ status: 'on_break' } as never)
    .eq('id', sessionId);
  if (updErr) throw updErr;
}

export async function endBreak(sessionId: string): Promise<void> {
  // Find the open break
  const { data: openBreak, error: selErr } = await supabase
    .from('attendance_breaks' as never)
    .select('*')
    .eq('session_id', sessionId)
    .is('end_at', null)
    .order('start_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!openBreak) throw new Error('No open break found');
  const br = openBreak as AttendanceBreak;
  const endAt = new Date();
  const startAt = new Date(br.start_at);
  const minutes = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60000));

  const { error: updBrkErr } = await supabase
    .from('attendance_breaks' as never)
    .update({ end_at: endAt.toISOString(), duration_minutes: minutes } as never)
    .eq('id', br.id);
  if (updBrkErr) throw updBrkErr;

  // Recompute total breaks
  const { data: allBreaks } = await supabase
    .from('attendance_breaks' as never)
    .select('duration_minutes')
    .eq('session_id', sessionId);
  const total = (allBreaks ?? []).reduce(
    (sum: number, b: { duration_minutes: number | null }) => sum + (b.duration_minutes ?? 0),
    0,
  );

  const { error: updSesErr } = await supabase
    .from('attendance_sessions' as never)
    .update({ status: 'active', total_break_minutes: total } as never)
    .eq('id', sessionId);
  if (updSesErr) throw updSesErr;
}

export async function checkOut(
  userId: string,
  session: AttendanceSession,
  payload: CapturePayload,
): Promise<AttendanceSession> {
  const current = await getSessionById(userId, session.id);
  if (!current) throw new Error('Your shift could not be found. Refresh attendance and try again.');
  if (current.status === 'completed' && current.check_out_at) return current;
  session = current;
  // Upload before changing breaks, so a failed photo leaves the shift untouched.
  const checkOutAt = new Date();
  const path = await uploadPhoto(userId, session.id, 'checkout', payload.photoBlob);
  // If a break is open, close it first
  if (session.status === 'on_break') {
    await endBreak(session.id);
  }

  // Recompute totals
  const { data: allBreaks, error: breaksError } = await supabase
    .from('attendance_breaks' as never)
    .select('duration_minutes')
    .eq('session_id', session.id);
  if (breaksError) throw breaksError;
  const totalBreak = (allBreaks ?? []).reduce(
    (sum: number, b: { duration_minutes: number | null }) => sum + (b.duration_minutes ?? 0),
    0,
  );

  const checkInAt = new Date(session.check_in_at);
  const totalMinutes = Math.max(
    0,
    Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000),
  );
  const workedMinutes = Math.max(0, totalMinutes - totalBreak);

  // Late checkout if work_date is more than 1 day before today
  const lateCutoff = new Date();
  lateCutoff.setHours(6, 0, 0, 0);
  const workDate = new Date(session.work_date + 'T00:00:00');
  const dayDiff = Math.floor(
    (lateCutoff.getTime() - workDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  const lateCheckout = dayDiff > 1;

  let updated: unknown;
  let saveError: unknown;
  try {
  const response = await supabase
    .from('attendance_sessions' as never)
    .update({
      status: 'completed',
      check_out_at: checkOutAt.toISOString(),
      check_out_photo_url: path,
      check_out_lat: payload.lat,
      check_out_lng: payload.lng,
      check_out_accuracy: payload.accuracy,
      total_break_minutes: totalBreak,
      worked_minutes: workedMinutes,
      late_checkout: lateCheckout,
    } as never)
    .eq('id', session.id)
    .eq('user_id', userId)
    .in('status', ['active', 'on_break'])
    .select('*')
    .maybeSingle();
    updated = response.data;
    saveError = response.error;
  } catch (error) { saveError = error; }
  if (saveError || !updated) {
    const saved = await getSessionById(userId, session.id).catch(() => null);
    if (saved?.status === 'completed' && saved.check_out_at) return saved;
    throw new Error(`Check-out could not be confirmed. ${attendanceErrorMessage(saveError)}`);
  }

  // Compute discipline fine (best-effort; non-blocking on failure)
  if (session.staff_id) {
    void recomputeDisciplineForSession({
      staffId: session.staff_id,
      userId,
      sessionId: session.id,
      workDate: session.work_date,
      checkInIso: session.check_in_at,
      checkOutIso: checkOutAt.toISOString(),
    });
  }

  if (session.staff_id) {
    notifyCheckoutWhatsapp(session.staff_id, checkOutAt.toISOString(), session.work_date);
  }

  return updated as AttendanceSession;
}

export async function getSignedPhotoUrl(path: string | null): Promise<string | null> {
  if (!path || path === 'pending') return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export function formatMinutes(min: number | null | undefined): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Clock time in the app's one style, e.g. "9:05 AM". */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(new Date(iso), 'h:mm a');
}

/** Plain-language label for a session status. */
export function formatSessionStatus(status: AttendanceStatus | string): string {
  if (status === 'active') return 'On shift';
  if (status === 'on_break') return 'On break';
  if (status === 'completed') return 'Completed';
  return status;
}

/**
 * Formats a session timestamp, appending the date suffix (e.g. ", 20 May") when
 * the timestamp falls on a different calendar day than the session's work_date.
 * Used so night-shift checkouts after midnight read as "2:00 AM, 20 May".
 */
export function formatSessionTime(iso: string | null | undefined, workDate: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const timeStr = formatTime(iso);
  if (format(d, 'yyyy-MM-dd') === workDate) return timeStr;
  return `${timeStr}, ${format(d, 'd MMM')}`;
}

/** Plain-language guidance for a getUserMedia failure. */
export function cameraErrorMessage(e: unknown): string {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission is blocked. Tap the lock icon in the address bar → Permissions → allow Camera, then tap Retry.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this phone. Check-in needs a front camera — try another phone, or ask your manager.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy in another app (for example a video call or WhatsApp). Close that app, then tap Retry.';
    default:
      return 'Could not start the camera. Close other apps that use the camera, then tap Retry.';
  }
}

/** Plain-language guidance for a geolocation failure. */
export function locationErrorMessage(code: number): string {
  switch (code) {
    case 1: // PERMISSION_DENIED
      return 'Location permission is blocked. Tap the lock icon in the address bar → Permissions → allow Location, then tap Retry location.';
    case 2: // POSITION_UNAVAILABLE
      return 'Your phone could not find your location. Turn on Location (GPS) in your phone settings, then tap Retry location.';
    case 3: // TIMEOUT
      return 'Finding your location took too long. Move near a window or step outside, then tap Retry location.';
    default:
      return 'Could not get your location. Turn on Location (GPS), then tap Retry location.';
  }
}

export function googleMapsLink(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/**
 * Recalculates the day's penalty from a session's check-in/check-out. Best effort: a failure
 * is logged and never blocks the check-out or edit that triggered it.
 */
export async function recomputeDisciplineForSession(params: {
  staffId: string;
  userId: string;
  sessionId: string;
  workDate: string;
  checkInIso: string;
  checkOutIso: string;
}): Promise<void> {
  try {
    const { data: staffRow } = await supabase
      .from('staff')
      .select('id, monthly_salary, attendance_tracked')
      .eq('id', params.staffId)
      .maybeSingle();
    if (!staffRow || (staffRow as { attendance_tracked?: boolean }).attendance_tracked === false) return;
    const monthlySalary = Number((staffRow as { monthly_salary?: number }).monthly_salary || 0);
    const wd = new Date(params.workDate + 'T00:00:00');
    const daysInMonth = new Date(wd.getFullYear(), wd.getMonth() + 1, 0).getDate();
    await computeAndLogDiscipline({ ...params, monthlySalary, daysInMonth });
  } catch (e) {
    console.error('Discipline compute failed', e);
  }
}

/** Owner/admin: add (sessionId null) or correct one attendance record. Returns the session id. */
export async function saveAttendanceRecord(params: {
  sessionId: string | null;
  staffId: string;
  workDate: string;
  checkInIso: string;
  checkOutIso: string | null;
  breakMinutes: number;
  reason: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc(
    'save_attendance_record' as never,
    {
      _session_id: params.sessionId,
      _staff_id: params.staffId,
      _work_date: params.workDate,
      _check_in: params.checkInIso,
      _check_out: params.checkOutIso,
      _break_minutes: params.breakMinutes,
      _reason: params.reason,
    } as never,
  );
  if (error) throw error;
  return data as unknown as string;
}

/** Owner/admin: delete a wrong attendance record (kept in the audit log). */
export async function deleteAttendanceRecord(sessionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc(
    'delete_attendance_record' as never,
    { _session_id: sessionId, _reason: reason } as never,
  );
  if (error) throw error;
}

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, MapPin, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { CapturePayload, attendanceErrorMessage, cameraErrorMessage, locationErrorMessage } from '@/lib/attendance';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  actionLabel: string;
  onCapture: (payload: CapturePayload) => Promise<void>;
}

export function CaptureDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  onCapture,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Bumped whenever the camera / location request is abandoned (dialog closed or retried),
  // so a getUserMedia or geolocation result that arrives late is discarded.
  const cameraGen = useRef(0);
  const locationGen = useRef(0);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [coords, setCoords] = useState<GeolocationPosition | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const submissionLock = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const stopCamera = () => {
    cameraGen.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  };

  const startCamera = async () => {
    stopCamera();
    const gen = cameraGen.current;
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser cannot open the camera. Open the app in Chrome, then tap Retry.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      if (gen !== cameraGen.current) {
        // Dialog closed (or Retry tapped) while the permission prompt was open.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (gen === cameraGen.current) setCameraReady(true);
      }
    } catch (e) {
      if (gen !== cameraGen.current) return;
      console.error('Camera error', e);
      setCameraError(cameraErrorMessage(e));
    }
  };

  const requestLocation = () => {
    const gen = ++locationGen.current;
    setLocationError(null);
    setCoords(null);
    setLocating(true);
    if (!navigator.geolocation) {
      setLocationError('This phone or browser cannot share location. Open the app in Chrome and try again.');
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (gen !== locationGen.current) return;
        setCoords(pos);
        setLocating(false);
      },
      (err) => {
        if (gen !== locationGen.current) return;
        console.error('Geolocation error', err);
        setLocationError(locationErrorMessage(err.code));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  useEffect(() => {
    if (open) {
      setSubmitError(null);
      startCamera();
      requestLocation();
    }
    return () => {
      stopCamera();
      locationGen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async () => {
    if (submissionLock.current || !videoRef.current || !canvasRef.current || !coords) return;
    if (!navigator.onLine) {
      setSubmitError('You are offline. Reconnect to the internet, then retry attendance.');
      return;
    }
    submissionLock.current = true;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      if (!w || !h) throw new Error('The camera is not ready. Wait for the picture, then retry.');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');
      ctx.drawImage(video, 0, 0, w, h);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Could not create photo'))),
          'image/jpeg',
          0.85,
        ),
      );

      await onCapture({
        photoBlob: blob,
        lat: coords.coords.latitude,
        lng: coords.coords.longitude,
        accuracy: coords.coords.accuracy,
      });

      onOpenChange(false);
    } catch (e) {
      console.error('Capture submit error', e);
      const message = attendanceErrorMessage(e);
      setSubmitError(message);
      toast.error('Failed', {
        description: message,
      });
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  };

  const canSubmit = cameraReady && !!coords && !submitting;

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Camera preview */}
          <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted">
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/80 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                Starting camera…
              </div>
            )}
            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-4 text-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm text-destructive">{cameraError}</p>
                <Button size="sm" variant="outline" onClick={startCamera}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />

          {/* Location status */}
          <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1">
              {locating && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Getting your location…
                </div>
              )}
              {coords && !locating && (
                <div>
                  <p className="font-medium">Location captured</p>
                  <p className="text-xs text-muted-foreground">
                    {coords.coords.latitude.toFixed(5)}, {coords.coords.longitude.toFixed(5)} (±
                    {Math.round(coords.coords.accuracy)}m)
                  </p>
                </div>
              )}
              {locationError && !locating && (
                <div>
                  <p className="font-medium text-destructive">Location required</p>
                  <p className="text-xs text-muted-foreground">{locationError}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={requestLocation}
                  >
                    <RefreshCw className="mr-2 h-3 w-3" />
                    Retry location
                  </Button>
                </div>
              )}
            </div>
          </div>
          {submitError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {submitError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Camera className="mr-2 h-4 w-4" />
                {actionLabel}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

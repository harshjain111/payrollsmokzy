import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MyAttendanceSummary } from '@/components/attendance/MyAttendanceSummary';
import { MyAttendanceLogs } from '@/components/attendance/MyAttendanceLogs';
import { MyLeaveSection } from '@/components/attendance/MyLeaveSection';
import { AttendanceWidget } from '@/components/attendance/AttendanceWidget';

export default function MyAttendance() {
  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="My Attendance" description="Track your shifts, sessions and leave" />

      <AttendanceWidget />

      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 md:w-auto md:inline-flex">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="logs">Daily Logs</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          <MyAttendanceSummary />
        </TabsContent>
        <TabsContent value="logs" className="space-y-4">
          <MyAttendanceLogs />
        </TabsContent>
        <TabsContent value="leave" className="space-y-4">
          <MyLeaveSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

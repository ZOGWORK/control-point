// What /chat shows while the app owner has messaging off for this team
// (a direct link or a notification still lands here). History is kept and
// comes back when messaging is switched on again.
import { MessageSquareOff } from 'lucide-react';
import { Page, EmptyState } from '../ui/page';

export function MessagingOff() {
  return (
    <Page className="py-10">
      <EmptyState
        icon={MessageSquareOff}
        title="Messaging is turned off for your team."
        description="Your team's channels and messages are kept, and come back when messaging is turned on again."
      />
    </Page>
  );
}

import { useLocalSearchParams } from 'expo-router';
import { EventDetailScreen } from '@/features/events/event-detail-screen';

export default function EventDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EventDetailScreen eventId={id ?? ''} />;
}

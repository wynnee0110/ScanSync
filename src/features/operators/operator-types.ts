export type OperatorRole = 'Superadmin' | 'Organizer' | 'Volunteer';

export type OperatorItem = {
  id: string;
  name: string;
  email: string;
  role: OperatorRole;
  assignedEventId: string | null;
  assignedEventName: string;
  generatedPasswordCode: string;
  scansCount: number;
  createdAt: string;
  createdBy?: string | null;
};

export type AccessStatusInfo = {
  label: string;
  isRevoked: boolean;
  color: string;
  bgColor: string;
};

/**
 * The effective role of the currently logged-in user in the Operators
 * Dashboard. This is mock/local until Supabase auth is wired up.
 */
export type ViewerRole = 'Superadmin' | 'Organizer';

/**
 * Context describing the current viewer's capabilities:
 * - `viewerRole`: whether they are a Superadmin or an Organizer.
 * - `viewerEventId`: for Organizers, the event they are assigned to manage.
 *   Null for Superadmins (they manage all events).
 * - `viewerEventName`: display name of the assigned event, used for UI labels.
 */
export type ViewerContext = {
  viewerRole: ViewerRole;
  viewerEventId: string | null;
  viewerEventName: string;
};

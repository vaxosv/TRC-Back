export type StravaObjectType = 'activity' | 'athlete';
export type StravaAspectType = 'create' | 'update' | 'delete';

// ── Webhook payload types ──────────────────────────────────────────────────

export interface StravaActivityUpdates {
  title?: string;
  type?: string;
  private?: 'true' | 'false';
}

export interface StravaAthleteUpdates {
  authorized: 'false';
}

export type StravaWebhookUpdates =
  | StravaActivityUpdates
  | StravaAthleteUpdates
  | Record<string, unknown>;

export interface WebhookEvent {
  object_type: StravaObjectType;
  object_id: number;
  aspect_type: StravaAspectType;
  updates: StravaWebhookUpdates;
  owner_id: number;
  subscription_id: number;
  event_time: number;
}

export interface StravaActivityEvent extends WebhookEvent {
  object_type: 'activity';
  updates: StravaActivityUpdates;
}

export interface StravaAthleteEvent extends WebhookEvent {
  object_type: 'athlete';
  updates: StravaAthleteUpdates;
}

// ── Domain models ──────────────────────────────────────────────────────────

export interface StravaAthlete {
  id: number;
  username: string;
  firstname: string;
  lastname: string;
  profile: string;
  city: string;
  country: string;
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  [key: string]: unknown;
}

export interface StravaActivity {
  id: number;
  name: string;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  type: string;
  startDate: string;
  averageSpeed: number;
  maxSpeed: number;
  totalElevationGain: number;
  stravaUrl?: string;
  fetchedAt: number;
}

// ── Strava API raw shapes ──────────────────────────────────────────────────

export interface StravaApiActivity {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  type: string;
  start_date: string;
  average_speed: number;
  max_speed: number;
  total_elevation_gain: number;
}

// ── Token / result types ───────────────────────────────────────────────────

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface ActivityResult {
  activities: StravaActivity[];
  refreshedTokens?: StravaTokens;
}

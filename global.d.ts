declare module "srt-webvtt";

type StringDict = Record<string, string>;
type NumberDict = Record<string, number>;
type BooleanDict = Record<string, boolean>;
type AnyDict = Record<string, any>;
type PCDict = Record<string, RTCPeerConnection>;
type HTMLVideoElementDict = Record<string, HTMLVideoElement>;
type MediaType = "vbrowser" | "screenshare" | "video" | "youtube";

interface User {
  id: string;
  isVideoChat?: boolean;
  isMuted?: boolean;
  isScreenShare?: boolean;
}

interface Reaction {
  user: string;
  value: string;
  msgId: string;
  msgTimestamp: string;
}

type ChatPayload = {
  msg: string;
  replyToId?: string;
  replyToTimestamp?: string;
  clientMessageId?: string;
};

interface ChatMessageBase {
  id: string;
  cmd?: string;
  msg?: string;
  system?: boolean;
  isSub?: boolean;
  replyToId?: string;
  replyToTimestamp?: string;
  replyToUserId?: string;
  replyToMsg?: string;
  clientMessageId?: string;
}

interface ChatMessage extends ChatMessageBase {
  timestamp: string;
  videoTS?: number;
  reactions?: { [value: string]: string[] };
  dbId?: string;
  name?: string;
  picture?: string;
  updatedAt?: string;
  userId?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
}

interface Settings {
  disableChatSound?: boolean;
}

interface PlaylistVideo {
  url: string;
  name: string;
  img?: string;
  channel?: string;
  duration: number;
  type: string;
}

interface SearchResult extends PlaylistVideo {
  size?: string | number;
  seeders?: string;
  magnet?: string;
  type: "youtube" | "file" | "magnet";
  url: string;
  name: string;
  duration: number;
}

interface HostState {
  video: string;
  videoTS: number;
  subtitle: string;
  paused: boolean;
  isVBrowserLarge: boolean;
  controller?: string;
  playbackRate: number;
  loop: boolean;
}

interface PersistentRoom {
  roomId: string;
  creationTime: string;
  passcode?: string;
  isChatDisabled?: boolean;
  roomTitle: string;
  roomDescription?: string;
  coverPhoto?: string | null;
  isSubRoom?: boolean;
  isPermanent?: boolean;
  data?: any;
  owner?: string;
  owner_id: string;
  status?: 'scheduled' | 'active' | 'inactive' | 'ended' | 'expired';
  startedAt?: Date | string;
  expiresAt?: Date | string;
  endedAt?: Date | string;
  participants_locked?: boolean;
}

interface LinkAccount {
  accountname: string;
  accountid: string;
  discriminator: string;
  kind: string;
}

interface ShardMetric {
  uptime: number;
  mem: number;
  roomCount: number;
  users: number;
  vbWaiting: number;
}

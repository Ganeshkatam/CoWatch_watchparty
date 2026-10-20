export interface AdmittedParticipantRecord {
  sessionId: string;
  uid?: string;
  admittedAt: number;
  lastConnectedAt: number;
  lastDisconnectedAt?: number;
  state: 'connected' | 'disconnected';
  admissionSequence: number;
  isKicked?: boolean;
}

export const ADMISSION_DISCONNECT_GRACE_MS = 10 * 60 * 1000; // 10 minutes

export interface RoomAdmissionCoordinatorDependencies {
  roomId: string;
  getOwnerId: () => string;
  getCurrentHostClientId: () => string;
  getClientToUidMap: () => StringDict;
  getNameMap: () => StringDict;
  getPictureMap: () => StringDict;
  getUidToNameMap: () => StringDict;
  getUidToPictureMap: () => StringDict;
  getRoster: () => User[];
}

export class RoomAdmissionCoordinator {
  public admittedParticipants: Map<string, AdmittedParticipantRecord> = new Map();
  public admittedMembers: Set<string> = new Set();
  public maxParticipants: number = 10;
  public participantsLocked: boolean = false;
  private nextAdmissionSequence: number = 1;

  private readonly deps: RoomAdmissionCoordinatorDependencies;

  constructor(deps: RoomAdmissionCoordinatorDependencies) {
    this.deps = deps;
  }

  public recordAdmittedParticipant = (
    clientId: string,
    sessionId?: string,
    uid?: string,
  ): void => {
    if (!clientId) return;
    const now = Date.now();

    const nameMap = this.deps.getNameMap();
    const pictureMap = this.deps.getPictureMap();
    const uidToNameMap = this.deps.getUidToNameMap();
    const uidToPictureMap = this.deps.getUidToPictureMap();

    // Clean up any stale participant records for the same sessionId to prevent duplicates
    if (sessionId) {
      for (const [oldClientId, rec] of this.admittedParticipants.entries()) {
        if (oldClientId !== clientId && rec.sessionId === sessionId) {
          if (nameMap[oldClientId] && !nameMap[clientId]) {
            nameMap[clientId] = nameMap[oldClientId];
          }
          if (pictureMap[oldClientId] && !pictureMap[clientId]) {
            pictureMap[clientId] = pictureMap[oldClientId];
          }
          this.admittedParticipants.delete(oldClientId);
        }
      }
    }

    if (uid) {
      if (uidToNameMap[uid] && !nameMap[clientId]) {
        nameMap[clientId] = uidToNameMap[uid];
      }
      if (uidToPictureMap[uid] && !pictureMap[clientId]) {
        pictureMap[clientId] = uidToPictureMap[uid];
      }
    }

    const existing = this.admittedParticipants.get(clientId);
    const admissionSequence =
      existing?.admissionSequence || this.nextAdmissionSequence++;
    this.admittedParticipants.set(clientId, {
      sessionId: sessionId || "",
      uid: uid || existing?.uid || undefined,
      admittedAt: existing?.admittedAt || now,
      lastConnectedAt: now,
      lastDisconnectedAt: undefined,
      state: "connected",
      admissionSequence,
      isKicked: existing?.isKicked || false,
    });
  };

  public verifyAdmittedSession = (sessionHint?: string, uid?: string): boolean => {
    if (uid) {
      const ownerId = this.deps.getOwnerId();
      if (ownerId && uid === ownerId) return true;
      if (this.admittedMembers.has(uid)) return true;
      if (this.hasParticipantUid(uid)) return true;
    }
    if (!sessionHint) return false;
    const now = Date.now();
    for (const [cId, record] of this.admittedParticipants.entries()) {
      if (record.sessionId === sessionHint) {
        if (record.isKicked) return false;
        if (record.state === "connected") return true;
        if (record.state === "disconnected" && record.lastDisconnectedAt) {
          if (now - record.lastDisconnectedAt <= ADMISSION_DISCONNECT_GRACE_MS) {
            return true;
          } else {
            this.admittedParticipants.delete(cId);
            return false;
          }
        }
      }
    }
    return false;
  };

  public verifyAdmittedParticipant = (
    clientIdOrSessionHint: string,
    sessionId?: string,
  ): boolean => {
    if (sessionId) {
      return this.verifyAdmittedSession(sessionId);
    }
    return this.verifyAdmittedSession(clientIdOrSessionHint);
  };

  public isRoomFull = (
    isOwner?: boolean,
    sessionHint?: string,
    uid?: string,
  ): boolean => {
    if (isOwner) return false;
    // Reconnecting participant with server-recognized session does not consume an extra slot
    if (this.verifyAdmittedSession(sessionHint, uid)) {
      return false;
    }

    // Active admitted participants calculation: connected or within 10-minute grace period
    const now = Date.now();
    let activeAdmittedCount = 0;
    for (const [, rec] of this.admittedParticipants.entries()) {
      if (rec.state === "connected") {
        activeAdmittedCount++;
      } else if (rec.state === "disconnected" && rec.lastDisconnectedAt) {
        if (now - rec.lastDisconnectedAt <= ADMISSION_DISCONNECT_GRACE_MS) {
          activeAdmittedCount++;
        }
      }
    }

    return activeAdmittedCount >= this.maxParticipants;
  };

  public hasParticipantUid = (uid: string): boolean => {
    if (!uid) return false;
    const ownerId = this.deps.getOwnerId();
    if (ownerId && ownerId === uid) return true;
    if (this.admittedMembers.has(uid)) return true;
    for (const rec of this.admittedParticipants.values()) {
      if (rec.uid === uid && rec.state === "connected" && !rec.isKicked) {
        return true;
      }
    }
    return false;
  };

  public isParticipantEligibleForHost = (clientId: string): boolean => {
    if (!clientId) return false;
    const roster = this.deps.getRoster();
    const inRoster = roster.some((u) => u.id === clientId);
    if (!inRoster) return false;
    const rec = this.admittedParticipants.get(clientId);
    if (!rec || rec.state !== "connected") return false;
    if (rec.isKicked) return false;
    if (!rec.sessionId) return false;
    // Must be authenticated with verified UID to hold host authority
    const clientToUidMap = this.deps.getClientToUidMap();
    const uid = rec.uid || clientToUidMap[clientId];
    if (!uid) return false;
    return true;
  };

  public isHostPresent = (): boolean => {
    const currentHostClientId = this.deps.getCurrentHostClientId();
    if (currentHostClientId) {
      const rec = this.admittedParticipants.get(currentHostClientId);
      if (rec && rec.state === "connected" && !rec.isKicked) {
        return true;
      }
    }
    const ownerId = this.deps.getOwnerId();
    if (ownerId) {
      for (const rec of this.admittedParticipants.values()) {
        if (rec.uid === ownerId && rec.state === "connected" && !rec.isKicked) {
          return true;
        }
      }
    }
    return false;
  };

  public getConnectedParticipantUids = (): string[] => {
    const uids = new Set<string>();
    const ownerId = this.deps.getOwnerId();
    if (ownerId) uids.add(ownerId);
    for (const rec of this.admittedParticipants.values()) {
      if (rec.uid && rec.state === "connected" && !rec.isKicked) {
        uids.add(rec.uid);
      }
    }
    return Array.from(uids);
  };

  public getEligibleParticipants = (
    excludeClientId?: string,
  ): { clientId: string; record: AdmittedParticipantRecord }[] => {
    const eligible: { clientId: string; record: AdmittedParticipantRecord }[] = [];
    for (const [cId, rec] of this.admittedParticipants.entries()) {
      if (excludeClientId && cId === excludeClientId) continue;
      if (this.isParticipantEligibleForHost(cId)) {
        eligible.push({ clientId: cId, record: rec });
      }
    }
    // Monotonically increasing admission sequence: lowest sequence ASC = highest failover priority
    eligible.sort((a, b) => a.record.admissionSequence - b.record.admissionSequence);
    return eligible;
  };

  public handleParticipantDisconnect = (clientId: string): void => {
    const admittedRecord = this.admittedParticipants.get(clientId);
    if (admittedRecord) {
      admittedRecord.state = "disconnected";
      admittedRecord.lastDisconnectedAt = Date.now();
    }
  };

  public scavengeDisconnectedParticipants = (
    now: number = Date.now(),
  ): void => {
    for (const [cId, rec] of this.admittedParticipants.entries()) {
      if (
        rec.state === "disconnected" &&
        rec.lastDisconnectedAt &&
        now - rec.lastDisconnectedAt > ADMISSION_DISCONNECT_GRACE_MS
      ) {
        this.admittedParticipants.delete(cId);
      }
    }
  };

  public removeParticipant = (clientId: string, uid?: string): void => {
    this.admittedParticipants.delete(clientId);
    if (uid) {
      this.admittedMembers.delete(uid);
    }
  };
}

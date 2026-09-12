import type { DatabasePool } from "../db.ts";
import type { IVBrowserProviderAdapter, VBrowserReservationRecord } from "./types.ts";

export interface SweeperReconciliationReport {
  expiredStaleReservations: number;
  recoveredAssignments: number;
  failedMissingVms: number;
  terminatedOrphanedVms: number;
  terminatedTerminalRoomReservations: number;
}

export class VBrowserOrphanSweeper {
  private db: DatabasePool | null;
  private provider: IVBrowserProviderAdapter;

  constructor(db: DatabasePool | null, provider: IVBrowserProviderAdapter) {
    this.db = db;
    this.provider = provider;
  }

  /**
   * Reconciles discrepancies between vbrowser_reservations, rooms, and provider VM instances.
   */
  public async reconcileOrphanedAllocations(options?: {
    unassignedTtlMs?: number;
    now?: number;
  }): Promise<SweeperReconciliationReport> {
    const report: SweeperReconciliationReport = {
      expiredStaleReservations: 0,
      recoveredAssignments: 0,
      failedMissingVms: 0,
      terminatedOrphanedVms: 0,
      terminatedTerminalRoomReservations: 0,
    };

    if (!this.db) {
      return report;
    }

    const now = options?.now || Date.now();
    const unassignedTtlMs = options?.unassignedTtlMs || 60 * 1000; // 60s

    try {
      // 1. Terminal room cleanup: reservations on rooms that are ended, expired, or inactive
      const terminalRoomsQuery = await this.db.query<{
        id: string;
        room_id: string;
        vmid: string | null;
        status: string;
        provider_id: string;
        room_status: string;
      }>(
        `SELECT r.id, r.room_id, r.vmid, r.status, r.provider_id, rm.status as room_status
         FROM vbrowser_reservations r
         JOIN rooms rm ON r.room_id = rm."roomId"
         WHERE rm.status IN ('ended', 'expired', 'inactive')
           AND r.status IN ('RESERVED', 'ALLOCATED', 'RELEASING')`
      );

      if (terminalRoomsQuery.rows && terminalRoomsQuery.rows.length > 0) {
        for (const row of terminalRoomsQuery.rows) {
          if (row.vmid) {
            await this.provider
              .release({ id: row.vmid, roomId: row.room_id, provider: row.provider_id })
              .catch(() => {});
          }
          await this.db.query(
            `UPDATE vbrowser_reservations
             SET status = 'RELEASED', released_at = NOW(), failure_reason = $1
             WHERE id = $2`,
            [`Room entered terminal state ${row.room_status}`, row.id]
          );
          report.terminatedTerminalRoomReservations++;
        }
      }

      // 2. Query all active reservations
      const activeRes = await this.db.query<VBrowserReservationRecord>(
        `SELECT * FROM vbrowser_reservations WHERE status IN ('RESERVED', 'ALLOCATED', 'RELEASING')`
      );

      const providerContainers = this.provider.listActiveContainers
        ? await this.provider.listActiveContainers()
        : [];
      const containerMap = new Map<string, { id: string; roomId?: string; reservationId?: string }>();
      for (const c of providerContainers) {
        containerMap.set(c.id, c);
        if (c.reservationId) {
          containerMap.set(`res_${c.reservationId}`, c);
        }
      }

      if (activeRes.rows && activeRes.rows.length > 0) {
        for (const res of activeRes.rows) {
          const createdAt = new Date(res.created_at || (res as any).assigned_at || 0).getTime();
          const ageMs = now - createdAt;

          if (res.status === "RESERVED") {
            const matchedContainer = containerMap.get(`res_${res.id}`);
            if (matchedContainer) {
              // Recover assignment
              await this.db.query(
                `UPDATE vbrowser_reservations
                 SET status = 'ALLOCATED', vmid = $1, assigned_at = NOW()
                 WHERE id = $2`,
                [matchedContainer.id, res.id]
              );
              report.recoveredAssignments++;
            } else if (ageMs > unassignedTtlMs) {
              // Expire stale unassigned reservation
              await this.db.query(
                `UPDATE vbrowser_reservations
                 SET status = 'EXPIRED', released_at = NOW(), failure_reason = 'Reservation unassigned TTL expired'
                 WHERE id = $1`,
                [res.id]
              );
              report.expiredStaleReservations++;
            }
          } else if (res.status === "ALLOCATED") {
            if (res.vmid && !containerMap.has(res.vmid) && providerContainers.length > 0) {
              // VM container absent in provider
              await this.db.query(
                `UPDATE vbrowser_reservations
                 SET status = 'FAILED', released_at = NOW(), failure_reason = 'VM absent in provider'
                 WHERE id = $1`,
                [res.id]
              );
              report.failedMissingVms++;
            }
          }
        }
      }

      // 3. Clean provider containers that have no active DB reservation
      if (providerContainers.length > 0) {
        const activeVmIds = new Set(
          (activeRes.rows || [])
            .map((r) => r.vmid)
            .filter((v): v is string => Boolean(v))
        );

        for (const container of providerContainers) {
          if (!activeVmIds.has(container.id)) {
            // Container has no corresponding ALLOCATED record
            await this.provider
              .release({ id: container.id, roomId: container.roomId })
              .catch(() => {});
            report.terminatedOrphanedVms++;
          }
        }
      }

      return report;
    } catch (err) {
      console.error("Error executing orphan sweeper reconciliation:", err);
      return report;
    }
  }

  /**
   * Bootstraps sweeper on startup and initializes provider pool status.
   */
  public async bootstrapAndReconcile(): Promise<SweeperReconciliationReport> {
    console.log("Running VBrowser boot reconciliation...");
    const report = await this.reconcileOrphanedAllocations();
    console.log("VBrowser boot reconciliation complete:", report);
    return report;
  }
}

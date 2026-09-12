import { useState, useEffect } from "react";
import {
  operationCoordinator,
  type OperationDomain,
  type AsyncStatus,
  type RoomInitStage,
  type PeerRtcStatus,
} from "../utils/operationState";

export function useOperationState(domain: OperationDomain, type?: string, targetId?: string) {
  const [isPending, setIsPending] = useState(() =>
    operationCoordinator.isPending(domain, type, targetId)
  );
  const [showSpinner, setShowSpinner] = useState(() =>
    operationCoordinator.shouldShowSpinner(domain, type, targetId)
  );
  const [status, setStatus] = useState<AsyncStatus>(() =>
    operationCoordinator.getDomainStatus(domain, type)
  );

  useEffect(() => {
    const unsubscribe = operationCoordinator.subscribe((d) => {
      if (d === domain) {
        setIsPending(operationCoordinator.isPending(domain, type, targetId));
        setShowSpinner(operationCoordinator.shouldShowSpinner(domain, type, targetId));
        setStatus(operationCoordinator.getDomainStatus(domain, type));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [domain, type, targetId]);

  return { isPending, showSpinner, status };
}

export function useRoomInitStage() {
  const [stage, setStage] = useState<RoomInitStage>(() => operationCoordinator.getInitStage());

  useEffect(() => {
    return operationCoordinator.onInitStageChange((newStage) => {
      setStage(newStage);
    });
  }, []);

  return {
    stage,
    isReady: stage === "ready",
    isConnecting: stage === "connecting" || stage === "synchronizing" || stage === "authenticating" || stage === "booting",
    isFailed: stage === "failed",
    isDegraded: stage === "degraded",
  };
}

export function usePeerRtcState(peerId: string) {
  const [status, setStatus] = useState<PeerRtcStatus>(() =>
    operationCoordinator.getPeerRtcStatus(peerId)
  );

  useEffect(() => {
    return operationCoordinator.subscribePeer((pId, newStatus) => {
      if (pId === peerId) {
        setStatus(newStatus);
      }
    });
  }, [peerId]);

  return {
    status,
    isConnecting: status === "connecting",
    isConnected: status === "connected",
    isDisconnected: status === "disconnected" || status === "failed" || status === "closed",
  };
}

import React, { useRef } from "react";
import QRCode from "react-qr-code";
import { Button } from "@mantine/core";
import { IconQrcode, IconDownload } from "@tabler/icons-react";
import styles from "./QRShare.module.css";

interface QRShareProps {
  roomId: string;
  canonicalJoinUrl: string;
}

export const QRShare: React.FC<QRShareProps> = ({ roomId, canonicalJoinUrl }) => {
  const cleanId = roomId.replace(/^\//, "").trim();
  const frameRef = useRef<HTMLDivElement>(null);

  const handleDownloadQr = () => {
    const svg = frameRef.current?.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.onload = () => {
      canvas.width = 400;
      canvas.height = 400;
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 20, 20, 360, 360);
        const a = document.createElement("a");
        a.download = `cowatch-${cleanId}-qr.png`;
        a.href = canvas.toDataURL("image/png");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      URL.revokeObjectURL(blobUrl);
    };

    img.src = blobUrl;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>
          <IconQrcode size={15} />
          Scan to Join
        </span>
      </div>

      <div className={styles.qrFrame} ref={frameRef}>
        <QRCode
          value={canonicalJoinUrl}
          size={160}
          style={{ width: 160, height: 160, display: "block" }}
        />
      </div>

      <span className={styles.caption}>
        Scan with your phone camera to join this watch party
      </span>

      <Button
        onClick={handleDownloadQr}
        variant="light"
        color="violet"
        size="sm"
        className={styles.downloadButton}
        leftSection={<IconDownload size={15} />}
      >
        Download QR
      </Button>
    </div>
  );
};

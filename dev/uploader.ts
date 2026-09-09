import fs from "node:fs";
import path from "node:path";
import { S3Client, ObjectCannedACL } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

// Configuration with standard AWS / Scaleway / S3-compatible fallbacks
const endpoint =
  process.env.S3_ENDPOINT ||
  process.env.SCW_ENDPOINT ||
  "https://s3.fr-par.scw.cloud";

const region =
  process.env.S3_REGION ||
  process.env.SCW_REGION ||
  process.env.AWS_REGION ||
  "fr-par";

const accessKeyId =
  process.env.S3_ACCESS_KEY_ID ||
  process.env.SCW_ACCESS_KEY ||
  process.env.AWS_ACCESS_KEY_ID;

const secretAccessKey =
  process.env.S3_SECRET_ACCESS_KEY ||
  process.env.SCW_SECRET_KEY ||
  process.env.AWS_SECRET_ACCESS_KEY;

const bucket =
  process.env.S3_BUCKET ||
  process.env.SCW_BUCKET ||
  "hcmedia";

const prefix = process.env.S3_PREFIX || "";
const targetAcl = (process.env.S3_ACL as ObjectCannedACL) || "public-read";

const localDir = process.argv[2] || process.env.LOCAL_DIR || "/var/www/html";

if (!accessKeyId || !secretAccessKey) {
  console.warn(
    "[uploader] Warning: S3 credentials are not set. Set S3_ACCESS_KEY_ID/SCW_ACCESS_KEY and S3_SECRET_ACCESS_KEY/SCW_SECRET_KEY in your environment."
  );
}

const client = new S3Client({
  region,
  endpoint,
  credentials:
    accessKeyId && secretAccessKey
      ? {
          accessKeyId,
          secretAccessKey,
        }
      : undefined,
  forcePathStyle: true,
});

/**
 * Recursively scans a directory and collects all file paths.
 */
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  if (!fs.existsSync(dirPath)) {
    return arrayOfFiles;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else if (entry.isFile()) {
      arrayOfFiles.push(fullPath);
    }
  }

  return arrayOfFiles;
}

/**
 * Uploads a single file using AWS SDK v3 multi-part lib-storage.
 */
async function uploadFile(
  filePath: string,
  baseDir: string
): Promise<void> {
  const relativePath = path.relative(baseDir, filePath).replace(/\\/g, "/");
  const sanitizedKey = relativePath.replace(/ /g, ".");
  const s3Key = prefix ? `${prefix.replace(/\/$/, "")}/${sanitizedKey}` : sanitizedKey;

  const fileStream = fs.createReadStream(filePath);
  const fileSize = fs.statSync(filePath).size;

  const parallelUpload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: s3Key,
      Body: fileStream,
      ACL: targetAcl,
    },
    queueSize: 4,
    partSize: 1024 * 1024 * 15, // 15 MB chunks
    leavePartsOnError: false,
  });

  parallelUpload.on("httpUploadProgress", (progress) => {
    if (progress.loaded && progress.total) {
      const pct = Math.round((progress.loaded / progress.total) * 100);
      console.log(`[uploader] ${s3Key}: ${pct}% (${progress.loaded}/${progress.total} bytes)`);
    }
  });

  await parallelUpload.done();
  console.log(`[uploader] Completed: ${s3Key} (${fileSize} bytes)`);
}

/**
 * Main upload runner.
 */
async function main() {
  console.log(`[uploader] Starting directory upload from: ${localDir}`);
  console.log(`[uploader] Destination: ${endpoint}/${bucket}/${prefix}`);

  if (!fs.existsSync(localDir)) {
    console.error(`[uploader] Error: Target local directory does not exist: ${localDir}`);
    process.exit(1);
  }

  const files = getAllFiles(localDir);
  console.log(`[uploader] Discovered ${files.length} file(s) to upload.`);

  if (files.length === 0) {
    console.log("[uploader] No files found to upload.");
    return;
  }

  // Upload files with bounded concurrency (up to 3 simultaneous files)
  const concurrency = 3;
  for (let i = 0; i < files.length; i += concurrency) {
    const chunk = files.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (file) => {
        try {
          await uploadFile(file, localDir);
        } catch (err: any) {
          console.error(`[uploader] Failed to upload ${file}:`, err?.message || err);
        }
      })
    );
  }

  console.log("[uploader] All uploads finished.");
}

main().catch((err) => {
  console.error("[uploader] Unhandled error during upload:", err);
  process.exit(1);
});

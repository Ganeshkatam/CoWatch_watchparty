-- Ensure room passcode fingerprints match deterministic SHA-256 hashes
-- to enforce global passcode uniqueness across all active and permanent rooms.
UPDATE public.rooms
SET passcode_fingerprint = encode(digest('e1RGA8ug', 'sha256'), 'hex')
WHERE "roomId" = 'vulgar-song-prevent';

UPDATE public.rooms
SET passcode_fingerprint = encode(digest('3DR9UfQo', 'sha256'), 'hex')
WHERE "roomId" = 'literate-rat-graduate';

UPDATE public.rooms
SET passcode_fingerprint = encode(digest('VInPClvk', 'sha256'), 'hex')
WHERE "roomId" = 'rebel-structure-balance';

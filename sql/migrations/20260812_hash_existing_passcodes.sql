UPDATE public.rooms
SET passcode = crypt(passcode, gen_salt('bf', 12))
WHERE passcode IS NOT NULL
  AND passcode NOT LIKE '$2a$%' 
  AND passcode NOT LIKE '$2b$%'
  AND passcode NOT LIKE '$2y$%';

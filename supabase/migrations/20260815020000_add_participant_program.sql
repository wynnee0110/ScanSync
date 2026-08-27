alter table public.participants
  add column program_code text;

alter table public.participants
  add constraint participants_program_code_length
  check (
    program_code is null
    or (char_length(btrim(program_code)) between 2 and 32)
  );

comment on column public.participants.external_reference is
  'Institution-issued participant identifier, such as a student ID. Treat as PII.';

comment on column public.participants.program_code is
  'Canonical program code supplied by the authorized event roster.';

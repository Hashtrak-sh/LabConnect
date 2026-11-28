-- Booking numbers (I3-CUS-01, SCHEMA_SPECIFICATION §5 booking.booking_no "LC-YYMM-NNNNNNN from a
-- sequence"; decided 2026-11-29). One running number for the platform that never repeats and
-- never resets: the month in the number is the IST month of submission, the seven digits come
-- from this sequence. A failed transaction leaves a gap, which is allowed.
CREATE SEQUENCE booking_no_seq AS bigint START WITH 1 MINVALUE 1 MAXVALUE 9999999 NO CYCLE;

-- The API submits bookings; the worker never does.
GRANT USAGE ON SEQUENCE booking_no_seq TO app_rw;

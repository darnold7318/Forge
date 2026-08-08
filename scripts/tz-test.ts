import { civilDateInZone, zoneOffsetMinutes, startOfCivilDay, resolveEffectiveZone, legacyInstantForCivilDate, addCivilDays } from "../shared/timezone";

let fail = 0;
function eq(label: string, got: any, want: any) {
  const ok = String(got) === String(want);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      got=${got}\n     want=${want}`);
}

const LA = "America/Los_Angeles";
const TOKYO = "Asia/Tokyo";

// The core bug: 7:30pm PDT Aug 7 must be Aug 7 locally, not Aug 8 UTC.
eq("evening PDT stays same local day", civilDateInZone(new Date("2026-08-08T02:30:00Z"), LA), "2026-08-07");
eq("same instant in UTC is next day", civilDateInZone(new Date("2026-08-08T02:30:00Z"), "UTC"), "2026-08-08");
eq("same instant in Tokyo", civilDateInZone(new Date("2026-08-08T02:30:00Z"), TOKYO), "2026-08-08");

// Offsets, incl. DST
eq("LA offset in summer (PDT -7)", zoneOffsetMinutes(new Date("2026-08-08T20:00:00Z"), LA), -420);
eq("LA offset in winter (PST -8)", zoneOffsetMinutes(new Date("2026-01-08T20:00:00Z"), LA), -480);
eq("Tokyo offset (+9)", zoneOffsetMinutes(new Date("2026-08-08T20:00:00Z"), TOKYO), 540);
eq("UTC offset", zoneOffsetMinutes(new Date("2026-08-08T20:00:00Z"), "UTC"), 0);

// Start of civil day
eq("start of Aug 8 in LA", startOfCivilDay("2026-08-08", LA).toISOString(), "2026-08-08T07:00:00.000Z");
eq("start of Jan 8 in LA", startOfCivilDay("2026-01-08", LA).toISOString(), "2026-01-08T08:00:00.000Z");
eq("start of Aug 8 in Tokyo", startOfCivilDay("2026-08-08", TOKYO).toISOString(), "2026-08-07T15:00:00.000Z");

// DST transition days (US spring forward 2026-03-08, fall back 2026-11-01)
eq("start of spring-forward day LA", startOfCivilDay("2026-03-08", LA).toISOString(), "2026-03-08T08:00:00.000Z");
eq("start of fall-back day LA", startOfCivilDay("2026-11-01", LA).toISOString(), "2026-11-01T07:00:00.000Z");
// Round-trip: start of day formatted back must equal the same civil date
for (const d of ["2026-03-08","2026-11-01","2026-08-08","2026-01-01","2026-12-31"]) {
  for (const z of [LA, TOKYO, "UTC", "Australia/Lord_Howe", "Asia/Kathmandu"]) {
    const rt = civilDateInZone(startOfCivilDay(d, z), z);
    if (rt !== d) { fail++; console.log(`FAIL  roundtrip ${d} ${z} -> ${rt}`); }
  }
}
console.log("PASS  civil-day roundtrip across zones/DST (incl. half-hour & 30min-DST zones)");

// resolveEffectiveZone
eq("home mode uses home zone", resolveEffectiveZone({timezoneMode:"home",homeTimezone:LA}, TOKYO), LA);
eq("auto mode uses client zone", resolveEffectiveZone({timezoneMode:"auto",homeTimezone:LA}, TOKYO), TOKYO);
eq("home mode w/o home falls back to client", resolveEffectiveZone({timezoneMode:"home",homeTimezone:null}, TOKYO), TOKYO);
eq("auto mode w/o client falls back to home", resolveEffectiveZone({timezoneMode:"auto",homeTimezone:LA}, null), LA);
eq("no info -> UTC", resolveEffectiveZone(null, null), "UTC");
eq("invalid zone ignored", resolveEffectiveZone({timezoneMode:"home",homeTimezone:"Mars/Olympus"}, LA), LA);

// legacy backfill: noon local
eq("legacy anchor = noon local LA", legacyInstantForCivilDate("2026-07-16", LA).toISOString(), "2026-07-16T19:00:00.000Z");
eq("legacy anchor formats back to same day", civilDateInZone(legacyInstantForCivilDate("2026-07-16", LA), LA), "2026-07-16");

eq("addCivilDays fwd", addCivilDays("2026-08-08", 3), "2026-08-11");
eq("addCivilDays across month", addCivilDays("2026-08-30", 3), "2026-09-02");
eq("addCivilDays back", addCivilDays("2026-03-01", -1), "2026-02-28");

console.log(fail === 0 ? "\nALL TIMEZONE TESTS PASSED" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);

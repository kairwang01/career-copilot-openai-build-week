# Beta Screenshot QA

Generated: 2026-06-26T14:40:53.666Z
Server: http://localhost:64499 (VITE_BETA_REDESIGN=true)

## Summary

- Routes checked: 4 marketing + 2 app shell
- Viewports: desktop 1280x800, mobile 390x844
- Result: ALL PASS

## Assertions per route

- data-beta-app marker present (marketing routes) / absent (app routes)
- data-beta-page matches expected id
- no forbidden MVP strings: "Go Beyond the Resume"
- no horizontal overflow

## Results

### `/` @ desktop — PASS
- OK data-beta-page=jobseeker-home
- OK no forbidden MVP strings
- OK no horizontal overflow

### `/employers` @ desktop — PASS
- OK data-beta-page=employer-landing
- OK no forbidden MVP strings
- OK no horizontal overflow

### `/sample-report` @ desktop — PASS
- OK data-beta-page=sample-report
- OK no forbidden MVP strings
- OK no horizontal overflow

### `/pricing` @ desktop — PASS
- OK data-beta-page=pricing
- OK no forbidden MVP strings
- OK no horizontal overflow

### `/workspace` @ desktop — PASS
- OK app shell route (no marketing marker)
- OK no horizontal overflow
- OK cookie banner avoids upload controls

### `/portal` @ desktop — PASS
- OK app shell route (no marketing marker)
- OK no horizontal overflow

### `/` @ mobile — PASS
- OK data-beta-page=jobseeker-home
- OK no forbidden MVP strings
- OK no horizontal overflow

### `/employers` @ mobile — PASS
- OK data-beta-page=employer-landing
- OK no forbidden MVP strings
- OK no horizontal overflow

### `/sample-report` @ mobile — PASS
- OK data-beta-page=sample-report
- OK no forbidden MVP strings
- OK no horizontal overflow

### `/pricing` @ mobile — PASS
- OK data-beta-page=pricing
- OK no forbidden MVP strings
- OK no horizontal overflow

### `/workspace` @ mobile — PASS
- OK app shell route (no marketing marker)
- OK no horizontal overflow
- OK cookie banner avoids upload controls

### `/portal` @ mobile — PASS
- OK app shell route (no marketing marker)
- OK no horizontal overflow

## Locale smoke (zh)

- OK zh hero copy rendered
- OK no raw site_ keys in zh render

## Failures

None.

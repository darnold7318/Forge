#!/usr/bin/env python3
"""Seed contrived workout data to manually verify coaching logic."""
import json
import urllib.request
from datetime import datetime, timedelta

BASE = "http://localhost:5000/api"


def post(path, body):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def create_workout(date, name):
    return post("/workouts", {"date": date, "name": name, "notes": None})


def create_set(workout_id, exercise_id, set_number, weight, reps, rir, is_warmup=False):
    return post(
        "/sets",
        {
            "workoutId": workout_id,
            "exerciseId": exercise_id,
            "setNumber": set_number,
            "weight": weight,
            "reps": reps,
            "rir": rir,
            "isWarmup": is_warmup,
        },
    )


BENCH_ID = 1  # Barbell Bench Press (Chest primary)
today = datetime.now()

# ---------------------------------------------------------------------------
# Scenario A: Progressive bench press sessions at top-of-range RIR-controlled
# reps -> should trigger "Increase Weight" recommendation.
# Sessions go from 8 weeks ago -> 1 week ago, weight climbing steadily,
# hitting top of rep range (12) at low RIR (1) consistently -> clear progression.
# ---------------------------------------------------------------------------
print("Seeding Scenario A: consistent progression at top of rep range, low RIR...")
bench_sessions = [
    (56, 135, 12, 2),
    (49, 140, 12, 2),
    (42, 140, 12, 1),
    (35, 145, 12, 2),
    (28, 145, 12, 1),
    (21, 150, 12, 1),
    (14, 150, 12, 1),
    (7, 150, 12, 1),  # last 3 sessions all top-of-range, low RIR -> increase weight signal
]
for days_ago, weight, reps, rir in bench_sessions:
    date = (today - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    w = create_workout(date, "Push Day")
    create_set(w["id"], BENCH_ID, 1, weight - 20, 10, 4, is_warmup=True)
    create_set(w["id"], BENCH_ID, 2, weight, reps, rir)
    create_set(w["id"], BENCH_ID, 3, weight, reps, rir)
    create_set(w["id"], BENCH_ID, 4, weight, max(reps - 1, 8), rir)

# ---------------------------------------------------------------------------
# Scenario B: Declining session quality over the last several workouts
# (dropping volume/weight/rising RIR) -> should trigger fatigue trend risk.
# Use Overhead Press (FrontDelts) with declining performance across 5 recent sessions.
# ---------------------------------------------------------------------------
print("Seeding Scenario B: declining sessions -> fatigue trend risk...")
OHP_ID = 12  # Overhead Press (FrontDelts primary)
declining_sessions = [
    (25, 95, 10, 2),
    (20, 95, 9, 2),
    (15, 90, 8, 3),
    (10, 85, 8, 3),
    (5, 80, 7, 4),
    (2, 75, 6, 4),  # most recent: notably worse than baseline
]
for days_ago, weight, reps, rir in declining_sessions:
    date = (today - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    w = create_workout(date, "Push Day")
    create_set(w["id"], OHP_ID, 1, weight, reps, rir)
    create_set(w["id"], OHP_ID, 2, weight, reps - 1, rir)
    create_set(w["id"], OHP_ID, 3, weight, reps - 1, rir)

# ---------------------------------------------------------------------------
# Scenario C: Heavy chest training today -> should show triceps/front-delt
# spillover fatigue in the recovery map (RELATED_MUSCLES: Chest -> FrontDelts, Triceps).
# ---------------------------------------------------------------------------
print("Seeding Scenario C: heavy chest session today -> triceps/front-delt spillover...")
INCLINE_DB_ID = 2  # Incline Dumbbell Press (Chest primary)
date_today = today.strftime("%Y-%m-%d")
w = create_workout(date_today, "Push Day - Heavy Chest")
create_set(w["id"], BENCH_ID, 1, 155, 5, 0)
create_set(w["id"], BENCH_ID, 2, 155, 5, 0)
create_set(w["id"], BENCH_ID, 3, 155, 5, 0)
create_set(w["id"], INCLINE_DB_ID, 1, 70, 8, 1)
create_set(w["id"], INCLINE_DB_ID, 2, 70, 8, 0)
create_set(w["id"], INCLINE_DB_ID, 3, 70, 7, 0)

print("Done seeding.")

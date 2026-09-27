---
name: sqlite-storage
description: Persistent per-conversation memory backed by SQLite. Use whenever you need to remember something across messages or sessions — notes, facts, reminders, structured records — or need to look up something you stored earlier.
---

# Persistent storage

You have a private SQLite database for this conversation (`storage.sqlite`,
accessed only through the `sqlite_storage` tool). It survives restarts. Nothing
else can read or write it — it's yours alone. There is no vector search here;
design real tables and query them with real SQL.

## Before you do anything else in a fresh conversation
Call `sqlite_storage` with `action: "schema"`. Don't assume what tables exist —
check. If nothing exists yet, that's normal; design tables as you need them.

## Design habits that avoid losing data
- Prefer a few well-named tables over one giant blob column. If you don't yet
  know the shape of what you're storing, start with a generic
  `notes(id INTEGER PRIMARY KEY, created_at TEXT, tag TEXT, body TEXT)` table
  rather than inventing throwaway schemas per message.
- Use `INSERT ... ON CONFLICT (...) DO UPDATE` for anything that should be
  "set this value" rather than "add another row" — read-modify-write races are
  rare here (one conversation, mostly one writer) but upserts are still the
  simplest way to avoid silent duplicates.
- Never `DROP TABLE` or bulk `DELETE` because a request sounds like it implies
  cleanup. Confirm with the person first if the instruction is ambiguous, and
  mention that a backup is taken automatically before any destructive
  statement (`storage-backups/`) if you do proceed.
- Use `exec` only for schema changes (`CREATE TABLE`, `ALTER TABLE`) or one-off
  multi-statement scripts. Use `run` for everyday single-statement writes so
  you get back `changes`/`lastInsertRowid` to confirm what happened.
- Large results are truncated. If `all` tells you a result was truncated,
  narrow the query (add a `WHERE`, a `LIMIT`, pick fewer columns) instead of
  assuming you saw everything.
- If you're about to do something destructive and the schema shows real data
  is at stake, call `backup` explicitly first and say so.

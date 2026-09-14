/*
 * Exports every Firestore collection this application uses to
 * a directory of JSON files.
 *
 * Google's own `gcloud firestore export` writes to a Cloud
 * Storage bucket, which needs the Blaze plan. This reads the
 * documents through the Admin SDK instead, so it works on
 * Spark and needs nothing but a service account key for the
 * project being read.
 *
 *   pnpm tsx scripts/export-firestore.ts --out ./handover/firestore
 *
 * Point it at a project with GOOGLE_APPLICATION_CREDENTIALS,
 * or at the emulator with FIRESTORE_EMULATOR_HOST.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getApps, initializeApp } from "firebase-admin/app";

import {
  getFirestore,
  type CollectionReference,
  type DocumentData,
} from "firebase-admin/firestore";

/*
 * Every collection the application reads or writes, and the
 * subcollections hanging off each. Kept in step with
 * `CLIENT_PATHS` in tests/rules/firestore.rules.test.ts — a
 * collection missing here is data left behind at handover.
 */
const COLLECTIONS: Array<{
  name: string;
  subcollections?: string[];
}> = [
  { name: "users" },
  {
    name: "vehicles",
    subcollections: ["serviceRecords"],
  },
  { name: "vehicleRegistry" },
  { name: "customers" },
  { name: "reservations" },
  {
    name: "reservationContracts",
    subcollections: ["versions", "deliveries"],
  },
  {
    name: "rentals",
    subcollections: ["inspections", "extensions"],
  },
  { name: "rentalFinancials" },
  { name: "payments" },
  { name: "refunds" },
  { name: "financialLedger" },
  { name: "vehicleExpenses" },
  { name: "auditLogs" },
  { name: "idempotencyKeys" },
  { name: "imports" },
];

/*
 * Timestamps, GeoPoints and references do not survive
 * `JSON.stringify` — a Timestamp becomes `{"_seconds":…}`,
 * which would import back as a plain map and break every date
 * in the application. Each is tagged on the way out and
 * rebuilt on the way in.
 */
type Tagged = { __type: string; value: unknown };

function encode(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(encode);
  }

  if (typeof value === "object") {
    const candidate = value as Record<
      string,
      unknown
    > & {
      toDate?: () => Date;
      latitude?: number;
      longitude?: number;
      path?: string;
    };

    if (typeof candidate.toDate === "function") {
      return {
        __type: "timestamp",
        value: candidate
          .toDate()
          .toISOString(),
      } satisfies Tagged;
    }

    if (
      typeof candidate.latitude === "number" &&
      typeof candidate.longitude === "number"
    ) {
      return {
        __type: "geopoint",
        value: {
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        },
      } satisfies Tagged;
    }

    if (
      typeof candidate.path === "string" &&
      "firestore" in candidate
    ) {
      return {
        __type: "reference",
        value: candidate.path,
      } satisfies Tagged;
    }

    if (Buffer.isBuffer(value)) {
      return {
        __type: "bytes",
        value: value.toString("base64"),
      } satisfies Tagged;
    }

    const out: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(
      candidate,
    )) {
      out[key] = encode(nested);
    }

    return out;
  }

  return value;
}

async function readCollection(
  reference: CollectionReference<DocumentData>,
  subcollections: string[],
): Promise<Record<string, unknown>> {
  const snapshot = await reference.get();

  const documents: Record<string, unknown> = {};

  for (const document of snapshot.docs) {
    const record: Record<string, unknown> = {
      data: encode(document.data()),
    };

    for (const child of subcollections) {
      const nested = await document.ref
        .collection(child)
        .get();

      if (nested.empty) {
        continue;
      }

      const rows: Record<string, unknown> = {};

      for (const entry of nested.docs) {
        rows[entry.id] = encode(entry.data());
      }

      record[`__sub_${child}`] = rows;
    }

    documents[document.id] = record;
  }

  return documents;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const outIndex = args.indexOf("--out");

  const out =
    outIndex >= 0 && args[outIndex + 1]
      ? args[outIndex + 1]
      : "./handover/firestore";

  const projectId =
    process.env.GCLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID;

  if (!getApps().length) {
    initializeApp(
      projectId ? { projectId } : undefined,
    );
  }

  const db = getFirestore();

  await mkdir(out, { recursive: true });

  const summary: Record<string, number> = {};

  for (const {
    name,
    subcollections = [],
  } of COLLECTIONS) {
    const documents = await readCollection(
      db.collection(name),
      subcollections,
    );

    const count = Object.keys(documents).length;

    summary[name] = count;

    await writeFile(
      join(out, `${name}.json`),
      `${JSON.stringify(documents, null, 2)}\n`,
    );

    console.log(
      `${name}: ${count} document(s)`,
    );
  }

  await writeFile(
    join(out, "manifest.json"),
    `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        projectId: projectId ?? null,
        counts: summary,
      },
      null,
      2,
    )}\n`,
  );

  const total = Object.values(summary).reduce(
    (sum, count) => sum + count,
    0,
  );

  console.log(
    `\nWrote ${total} document(s) to ${out}`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : error,
  );

  process.exitCode = 1;
});

/*
 * Loads an export from `scripts/export-firestore.ts` into a
 * Firestore project.
 *
 * It refuses to run against a project that already holds data
 * unless told to, so a handover cannot quietly overwrite a
 * live database. Nothing is deleted: documents are written by
 * the ids they had, so a re-run repairs a partial import
 * rather than duplicating it.
 *
 *   pnpm tsx scripts/import-firestore.ts --in ./handover/firestore
 *   pnpm tsx scripts/import-firestore.ts --in ./handover/firestore --commit
 *
 * Point it at the destination with GOOGLE_APPLICATION_CREDENTIALS
 * for that project. Run it without --commit first: the dry run
 * reports exactly what would be written.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { getApps, initializeApp } from "firebase-admin/app";

import {
  getFirestore,
  GeoPoint,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";

function decode(
  value: unknown,
  db: Firestore,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      decode(entry, db),
    );
  }

  if (typeof value === "object") {
    const tagged = value as {
      __type?: string;
      value?: unknown;
    };

    if (tagged.__type === "timestamp") {
      return Timestamp.fromDate(
        new Date(String(tagged.value)),
      );
    }

    if (tagged.__type === "geopoint") {
      const point = tagged.value as {
        latitude: number;
        longitude: number;
      };

      return new GeoPoint(
        point.latitude,
        point.longitude,
      );
    }

    if (tagged.__type === "reference") {
      return db.doc(String(tagged.value));
    }

    if (tagged.__type === "bytes") {
      return Buffer.from(
        String(tagged.value),
        "base64",
      );
    }

    const out: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = decode(nested, db);
    }

    return out;
  }

  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const inIndex = args.indexOf("--in");

  const source =
    inIndex >= 0 && args[inIndex + 1]
      ? args[inIndex + 1]
      : "./handover/firestore";

  const commit = args.includes("--commit");

  const force = args.includes(
    "--overwrite-existing",
  );

  const projectId =
    process.env.GCLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID;

  if (!getApps().length) {
    initializeApp(
      projectId ? { projectId } : undefined,
    );
  }

  const db = getFirestore();

  const files = (await readdir(source)).filter(
    (name) =>
      name.endsWith(".json") &&
      name !== "manifest.json",
  );

  if (files.length === 0) {
    throw new Error(
      `No exported collections found in ${source}.`,
    );
  }

  /*
   * A destination that already holds customers or rentals is
   * almost certainly the wrong project, or one that has been
   * used since the export was taken. Stop rather than merge
   * two datasets together.
   */
  if (commit && !force) {
    for (const guard of [
      "customers",
      "rentals",
      "reservations",
    ]) {
      const existing = await db
        .collection(guard)
        .limit(1)
        .get();

      if (!existing.empty) {
        throw new Error(
          `${guard} already has documents in ${
            projectId ?? "this project"
          }. Check you are pointing at the new project, then re-run with --overwrite-existing if that is really what you want.`,
        );
      }
    }
  }

  let written = 0;

  for (const file of files) {
    const name = file.replace(/\.json$/, "");

    const documents = JSON.parse(
      await readFile(
        join(source, file),
        "utf8",
      ),
    ) as Record<
      string,
      Record<string, unknown>
    >;

    const ids = Object.keys(documents);

    console.log(
      `${name}: ${ids.length} document(s)`,
    );

    if (!commit) {
      written += ids.length;
      continue;
    }

    /* Firestore takes 500 writes per batch. */
    let batch = db.batch();
    let queued = 0;

    const flush = async () => {
      if (queued > 0) {
        await batch.commit();
        batch = db.batch();
        queued = 0;
      }
    };

    for (const id of ids) {
      const record = documents[id];

      batch.set(
        db.collection(name).doc(id),
        decode(
          record.data,
          db,
        ) as Record<string, unknown>,
      );

      queued += 1;
      written += 1;

      for (const [key, rows] of Object.entries(
        record,
      )) {
        if (!key.startsWith("__sub_")) {
          continue;
        }

        const child = key.slice("__sub_".length);

        for (const [
          childId,
          childData,
        ] of Object.entries(
          rows as Record<string, unknown>,
        )) {
          batch.set(
            db
              .collection(name)
              .doc(id)
              .collection(child)
              .doc(childId),
            decode(childData, db) as Record<
              string,
              unknown
            >,
          );

          queued += 1;
          written += 1;

          if (queued >= 450) {
            await flush();
          }
        }
      }

      if (queued >= 450) {
        await flush();
      }
    }

    await flush();
  }

  console.log(
    commit
      ? `\nWrote ${written} document(s) to ${
          projectId ?? "the configured project"
        }.`
      : `\nDry run: ${written} document(s) would be written. Re-run with --commit.`,
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

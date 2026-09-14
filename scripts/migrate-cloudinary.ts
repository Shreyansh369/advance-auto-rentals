/*
 * Moves the uploaded images to the client's own Cloudinary
 * account and rewrites the stored URLs to match.
 *
 * Only needed if the account itself is not being handed over.
 * Transferring the existing account (Cloudinary Settings →
 * Account → change the owner email) moves every asset and
 * every URL already in Firestore with it, and is the option to
 * prefer — see docs/handover.md.
 *
 * Each asset is fetched from the old cloud and uploaded to the
 * new one through the same unsigned preset the application
 * uses, so no private Cloudinary key is needed on either side.
 *
 *   pnpm tsx scripts/migrate-cloudinary.ts \
 *     --to-cloud <new-cloud-name> \
 *     --preset <new-unsigned-preset>
 *
 *   pnpm tsx scripts/migrate-cloudinary.ts ... --commit
 *
 * Point it at the destination Firestore project with
 * GOOGLE_APPLICATION_CREDENTIALS. Nothing is deleted from the
 * old account: if the import is wrong, the originals are still
 * where they were.
 */
import { getApps, initializeApp } from "firebase-admin/app";

import { getFirestore } from "firebase-admin/firestore";

/*
 * Where an image URL can be stored. Each entry is a collection
 * and the field holding either a URL or a list of media
 * records.
 */
const MEDIA_FIELDS: Array<{
  collection: string;
  field: string;
  kind: "url" | "list";
}> = [
  {
    collection: "customers",
    field: "licenceStoragePath",
    kind: "url",
  },
  {
    collection: "vehicles",
    field: "photos",
    kind: "list",
  },
  {
    collection: "reservations",
    field: "bookingMedia",
    kind: "list",
  },
  {
    collection: "rentals",
    field: "checkoutMedia",
    kind: "list",
  },
  {
    collection: "rentals",
    field: "returnMedia",
    kind: "list",
  },
];

function argOf(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 &&
    process.argv[index + 1] &&
    !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : null;
}

type Uploaded = {
  url: string;
  publicId: string;
};

const uploads = new Map<string, Uploaded>();

async function reupload(
  sourceUrl: string,
  cloud: string,
  preset: string,
): Promise<Uploaded> {
  const already = uploads.get(sourceUrl);

  if (already) {
    return already;
  }

  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(
      `Could not fetch ${sourceUrl} (${response.status}).`,
    );
  }

  const blob = await response.blob();

  const payload = new FormData();

  payload.append("file", blob);
  payload.append("upload_preset", preset);

  payload.append(
    "tags",
    "advance-auto-rentals,migrated",
  );

  const upload = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      cloud,
    )}/auto/upload`,
    { method: "POST", body: payload },
  );

  if (!upload.ok) {
    throw new Error(
      `Cloudinary refused the upload (${upload.status}). Check the preset is unsigned and allows this file type.`,
    );
  }

  const result = (await upload.json()) as {
    secure_url?: string;
    public_id?: string;
  };

  if (!result.secure_url || !result.public_id) {
    throw new Error(
      "Cloudinary accepted the upload but returned no URL.",
    );
  }

  const record: Uploaded = {
    url: result.secure_url,
    publicId: result.public_id,
  };

  uploads.set(sourceUrl, record);

  return record;
}

function isForeignCloudinaryUrl(
  value: unknown,
  destination: string,
): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(
      "https://res.cloudinary.com/",
    ) &&
    !value.startsWith(
      `https://res.cloudinary.com/${destination}/`,
    )
  );
}

async function main(): Promise<void> {
  const cloud = argOf("to-cloud");
  const preset = argOf("preset");
  const commit = process.argv.includes("--commit");

  if (!cloud || !preset) {
    throw new Error(
      "Pass --to-cloud <new cloud name> and --preset <new unsigned preset>.",
    );
  }

  const projectId =
    process.env.GCLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID;

  if (!getApps().length) {
    initializeApp(
      projectId ? { projectId } : undefined,
    );
  }

  const db = getFirestore();

  let moved = 0;
  let skipped = 0;

  for (const {
    collection,
    field,
    kind,
  } of MEDIA_FIELDS) {
    const snapshot = await db
      .collection(collection)
      .get();

    for (const document of snapshot.docs) {
      const current = document.get(field);

      if (kind === "url") {
        if (
          !isForeignCloudinaryUrl(
            current,
            cloud,
          )
        ) {
          skipped += 1;
          continue;
        }

        console.log(
          `${collection}/${document.id}.${field}`,
        );

        moved += 1;

        if (!commit) {
          continue;
        }

        const uploaded = await reupload(
          current,
          cloud,
          preset,
        );

        await document.ref.update({
          [field]: uploaded.url,
        });

        continue;
      }

      if (!Array.isArray(current)) {
        skipped += 1;
        continue;
      }

      const next: unknown[] = [];
      let changed = false;

      for (const entry of current) {
        const item = entry as Record<
          string,
          unknown
        >;

        if (
          !isForeignCloudinaryUrl(
            item?.url,
            cloud,
          )
        ) {
          next.push(entry);
          continue;
        }

        console.log(
          `${collection}/${document.id}.${field}[] ${String(
            item.url,
          ).slice(0, 80)}`,
        );

        moved += 1;
        changed = true;

        if (!commit) {
          next.push(entry);
          continue;
        }

        const uploaded = await reupload(
          item.url as string,
          cloud,
          preset,
        );

        next.push({
          ...item,
          url: uploaded.url,
          publicId: uploaded.publicId,
        });
      }

      if (changed && commit) {
        await document.ref.update({
          [field]: next,
        });
      }
    }
  }

  console.log(
    commit
      ? `\nMoved ${moved} image(s) to ${cloud}. ${skipped} field(s) had nothing to move.`
      : `\nDry run: ${moved} image(s) would move to ${cloud}. Re-run with --commit.`,
  );

  if (commit && moved > 0) {
    console.log(
      "The originals are untouched in the old account. Delete them only once the new URLs have been checked in the application.",
    );
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : error,
  );

  process.exitCode = 1;
});

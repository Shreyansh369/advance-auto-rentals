import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

import { getFirebaseClient } from "@/lib/firebase/client";

/*
 * Staff access administration.
 *
 * The security rules read `role` and `status` from
 * `users/{uid}`: an account with `status: "pending"` can
 * sign in and reach nothing at all. Approving one used to
 * mean editing the document by hand in the Firebase console,
 * which is why accounts sat waiting. These are the writes
 * behind the Staff screen, and every one of them is an
 * administrator decision that leaves an audit record.
 */
export type StaffRole = "admin" | "operations";

export type StaffStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "suspended";

export type StaffMember = {
  uid: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  age: number | null;
  requestedRole: StaffRole | null;
  role: StaffRole | null;
  status: StaffStatus;
  createdAt: string | null;
  decidedAt: string | null;
  decidedByNameSnapshot: string | null;
  decisionNote: string | null;
  notifiedAt: string | null;
};

function trimmedOrNull(
  value: unknown,
): string | null {
  return typeof value === "string" &&
    value.trim().length > 0
    ? value.trim()
    : null;
}

function toIsoOrNull(
  value: unknown,
): string | null {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function asRole(
  value: unknown,
): StaffRole | null {
  return value === "admin" ||
    value === "operations"
    ? value
    : null;
}

function asStatus(value: unknown): StaffStatus {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();

  if (
    status === "approved" ||
    status === "rejected" ||
    status === "suspended"
  ) {
    return status;
  }

  return "pending";
}

function getActorUid(): string {
  const user =
    getFirebaseClient().auth.currentUser;

  if (!user) {
    throw new Error(
      "Your session has expired. Please sign in again.",
    );
  }

  return user.uid;
}

/** A rental office has staff, not a user base. */
const STAFF_LIMIT = 200;

/**
 * Every staff profile, newest request first.
 *
 * Only an administrator may list `users`, so an operations
 * account reaching this is refused by the rules rather than
 * by the screen alone.
 */
export async function listStaff(): Promise<
  StaffMember[]
> {
  const { db } = getFirebaseClient();

  const [profiles, notifications] =
    await Promise.all([
      getDocs(
        query(
          collection(db, "users"),
          limit(STAFF_LIMIT),
        ),
      ),

      /*
       * Whether the office was told is useful on the screen,
       * but it must never keep the queue from loading: the
       * receipts are a convenience, the queue is the point.
       */
      getDocs(
        query(
          collection(
            db,
            "staffAccessRequests",
          ),
          limit(STAFF_LIMIT),
        ),
      ).catch(() => null),
    ]);

  const notifiedAt = new Map<string, string>();

  for (const entry of notifications?.docs ??
    []) {
    const moment = toIsoOrNull(
      entry.get("notifiedAt"),
    );

    if (moment) {
      notifiedAt.set(entry.id, moment);
    }
  }

  const members = profiles.docs.map(
    (snapshot): StaffMember => {
      const age = snapshot.get("age");

      return {
        uid: snapshot.id,

        fullName:
          trimmedOrNull(
            snapshot.get("fullName"),
          ) ??
          trimmedOrNull(
            snapshot.get("email"),
          ) ??
          "Unnamed account",

        email: trimmedOrNull(
          snapshot.get("email"),
        ),

        mobile: trimmedOrNull(
          snapshot.get("mobile"),
        ),

        age:
          typeof age === "number" &&
          Number.isFinite(age)
            ? age
            : null,

        requestedRole: asRole(
          snapshot.get("requestedRole"),
        ),

        role: asRole(snapshot.get("role")),

        status: asStatus(
          snapshot.get("status"),
        ),

        createdAt: toIsoOrNull(
          snapshot.get("createdAt"),
        ),

        decidedAt: toIsoOrNull(
          snapshot.get("decidedAt"),
        ),

        decidedByNameSnapshot: trimmedOrNull(
          snapshot.get("decidedByNameSnapshot"),
        ),

        decisionNote: trimmedOrNull(
          snapshot.get("decisionNote"),
        ),

        notifiedAt:
          notifiedAt.get(snapshot.id) ?? null,
      };
    },
  );

  const rank: Record<StaffStatus, number> = {
    pending: 0,
    approved: 1,
    suspended: 2,
    rejected: 3,
  };

  return members.sort((left, right) => {
    if (
      rank[left.status] !== rank[right.status]
    ) {
      return (
        rank[left.status] - rank[right.status]
      );
    }

    return (right.createdAt ?? "").localeCompare(
      left.createdAt ?? "",
    );
  });
}

export type StaffDecision =
  | {
      outcome: "approve";
      uid: string;
      role: StaffRole;
      note?: string | null;
    }
  | {
      outcome: "reject" | "suspend";
      uid: string;
      note?: string | null;
    };

/**
 * Approve, decline or withdraw an account.
 *
 * The write is a transaction so the decision and its audit
 * record land together, and so an administrator cannot act
 * on a profile that has already been removed.
 */
export async function decideStaffAccess(
  decision: StaffDecision,
): Promise<{
  uid: string;
  status: StaffStatus;
  role: StaffRole | null;
}> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  if (decision.uid === actorUid) {
    throw new Error(
      "You cannot change your own access. Ask another administrator.",
    );
  }

  const note =
    trimmedOrNull(decision.note)?.slice(0, 500) ??
    null;

  const status: StaffStatus =
    decision.outcome === "approve"
      ? "approved"
      : decision.outcome === "reject"
        ? "rejected"
        : "suspended";

  const role =
    decision.outcome === "approve"
      ? decision.role
      : null;

  await runTransaction(db, async (transaction) => {
    const profileRef = doc(
      db,
      "users",
      decision.uid,
    );

    const [profile, actorProfile] =
      await Promise.all([
        transaction.get(profileRef),
        transaction.get(
          doc(db, "users", actorUid),
        ),
      ]);

    if (!profile.exists()) {
      throw new Error(
        "That staff profile no longer exists.",
      );
    }

    const actorName =
      trimmedOrNull(
        actorProfile.get("fullName"),
      ) ??
      trimmedOrNull(
        actorProfile.get("email"),
      ) ??
      actorUid;

    transaction.update(profileRef, {
      status,
      role,
      decisionNote: note,
      decidedAt: serverTimestamp(),
      decidedBy: actorUid,
      decidedByNameSnapshot: actorName,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    transaction.set(
      doc(collection(db, "auditLogs")),
      {
        actorUid,

        action:
          decision.outcome === "approve"
            ? "user.access_approved"
            : decision.outcome === "reject"
              ? "user.access_rejected"
              : "user.access_suspended",

        resource: {
          collection: "users",
          id: decision.uid,
        },

        details: {
          actorName,
          status,
          role,
          note,

          requestedRole: asRole(
            profile.get("requestedRole"),
          ),

          previousStatus: asStatus(
            profile.get("status"),
          ),

          previousRole: asRole(
            profile.get("role"),
          ),

          emailSnapshot: trimmedOrNull(
            profile.get("email"),
          ),
        },

        createdAt: serverTimestamp(),
      },
    );
  });

  return {
    uid: decision.uid,
    status,
    role,
  };
}

/**
 * Move an approved account between roles without taking it
 * through approval again.
 */
export async function changeStaffRole(options: {
  uid: string;
  role: StaffRole;
}): Promise<{ uid: string; role: StaffRole }> {
  const { db } = getFirebaseClient();

  const actorUid = getActorUid();

  if (options.uid === actorUid) {
    throw new Error(
      "You cannot change your own role. Ask another administrator.",
    );
  }

  await runTransaction(db, async (transaction) => {
    const profileRef = doc(
      db,
      "users",
      options.uid,
    );

    const [profile, actorProfile] =
      await Promise.all([
        transaction.get(profileRef),
        transaction.get(
          doc(db, "users", actorUid),
        ),
      ]);

    if (!profile.exists()) {
      throw new Error(
        "That staff profile no longer exists.",
      );
    }

    if (
      asStatus(profile.get("status")) !==
      "approved"
    ) {
      throw new Error(
        "Approve this account before assigning a role.",
      );
    }

    const actorName =
      trimmedOrNull(
        actorProfile.get("fullName"),
      ) ??
      trimmedOrNull(
        actorProfile.get("email"),
      ) ??
      actorUid;

    transaction.update(profileRef, {
      role: options.role,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    });

    transaction.set(
      doc(collection(db, "auditLogs")),
      {
        actorUid,

        action: "user.role_changed",

        resource: {
          collection: "users",
          id: options.uid,
        },

        details: {
          actorName,
          role: options.role,

          previousRole: asRole(
            profile.get("role"),
          ),

          emailSnapshot: trimmedOrNull(
            profile.get("email"),
          ),
        },

        createdAt: serverTimestamp(),
      },
    );
  });

  return {
    uid: options.uid,
    role: options.role,
  };
}

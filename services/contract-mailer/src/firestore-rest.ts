/*
 * A very small Firestore REST client.
 *
 * The endpoint acts as the signed-in employee rather than as
 * a privileged service: every call carries that employee's
 * own ID token, so the same security rules that govern the
 * browser also govern this function. There is no service
 * account key to deploy, store or leak, and a request can
 * never read more than the person who made it could.
 */
export type FirestoreValue =
  | string
  | number
  | boolean
  | null
  | FirestoreValue[]
  | { [key: string]: FirestoreValue };

type RestValue = Record<string, unknown>;

export class FirestoreError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function decodeValue(
  value: RestValue | undefined,
): FirestoreValue {
  if (!value) {
    return null;
  }

  if ("nullValue" in value) {
    return null;
  }

  if ("stringValue" in value) {
    return String(value.stringValue);
  }

  if ("booleanValue" in value) {
    return Boolean(value.booleanValue);
  }

  if ("integerValue" in value) {
    return Number(value.integerValue);
  }

  if ("doubleValue" in value) {
    return Number(value.doubleValue);
  }

  if ("timestampValue" in value) {
    return String(value.timestampValue);
  }

  if ("mapValue" in value) {
    const map = value.mapValue as {
      fields?: Record<string, RestValue>;
    };

    return decodeFields(map.fields);
  }

  if ("arrayValue" in value) {
    const array = value.arrayValue as {
      values?: RestValue[];
    };

    return (array.values ?? []).map(decodeValue);
  }

  return null;
}

export function decodeFields(
  fields: Record<string, RestValue> | undefined,
): Record<string, FirestoreValue> {
  const decoded: Record<string, FirestoreValue> =
    {};

  for (const [key, value] of Object.entries(
    fields ?? {},
  )) {
    decoded[key] = decodeValue(value);
  }

  return decoded;
}

export function encodeValue(
  value: FirestoreValue,
): RestValue {
  if (value === null) {
    return { nullValue: null };
  }

  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { booleanValue: value };
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(encodeValue),
      },
    };
  }

  return {
    mapValue: { fields: encodeFields(value) },
  };
}

export function encodeFields(
  value: Record<string, FirestoreValue>,
): Record<string, RestValue> {
  const fields: Record<string, RestValue> = {};

  for (const [key, item] of Object.entries(
    value,
  )) {
    fields[key] = encodeValue(item);
  }

  return fields;
}

export type FirestoreClient = {
  getDocument: (
    path: string,
  ) => Promise<Record<
    string,
    FirestoreValue
  > | null>;

  createDocument: (
    collectionPath: string,
    documentId: string,
    data: Record<string, FirestoreValue>,
  ) => Promise<void>;
};

function documentsUrl(
  baseUrl: string,
  projectId: string,
): string {
  return `${baseUrl.replace(
    /\/+$/,
    "",
  )}/v1/projects/${encodeURIComponent(
    projectId,
  )}/databases/(default)/documents`;
}

async function describeFailure(
  response: Response,
): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };

    return (
      body.error?.message ??
      `Firestore responded with ${response.status}.`
    );
  } catch {
    return `Firestore responded with ${response.status}.`;
  }
}

export function createFirestoreClient(options: {
  baseUrl: string;
  projectId: string;
  idToken: string;
  fetchImpl?: typeof fetch;
}): FirestoreClient {
  const root = documentsUrl(
    options.baseUrl,
    options.projectId,
  );

  const call = options.fetchImpl ?? fetch;

  const headers = {
    Authorization: `Bearer ${options.idToken}`,
    "Content-Type": "application/json",
  };

  return {
    async getDocument(path) {
      const response = await call(
        `${root}/${path}`,
        { headers },
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new FirestoreError(
          response.status,
          await describeFailure(response),
        );
      }

      const body = (await response.json()) as {
        fields?: Record<string, RestValue>;
      };

      return decodeFields(body.fields);
    },

    async createDocument(
      collectionPath,
      documentId,
      data,
    ) {
      const response = await call(
        `${root}/${collectionPath}?documentId=${encodeURIComponent(
          documentId,
        )}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            fields: encodeFields(data),
          }),
        },
      );

      if (!response.ok) {
        throw new FirestoreError(
          response.status,
          await describeFailure(response),
        );
      }
    },
  };
}

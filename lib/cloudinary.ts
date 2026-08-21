export type CloudinaryMedia = {
  url: string;
  publicId: string;
  resourceType: "image" | "video";
  format: string;
  bytes: number;
  originalFilename: string;
  width?: number;
  height?: number;
  duration?: number;
};

const MAX_IMAGE_BYTES =
  10 * 1024 * 1024;

const MAX_VIDEO_BYTES =
  100 * 1024 * 1024;

function cloudinaryConfig() {
  const cloudName =
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

  const uploadPreset =
    process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error(
      "Cloudinary is not configured. Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.",
    );
  }

  return {
    cloudName,
    uploadPreset,
  };
}

export async function uploadVehicleMedia(
  file: File,
  stage: "booking" | "return",
): Promise<CloudinaryMedia> {
  const {
    cloudName,
    uploadPreset,
  } = cloudinaryConfig();

  const isVideo =
    file.type.startsWith("video/");

  const maxBytes = isVideo
    ? MAX_VIDEO_BYTES
    : MAX_IMAGE_BYTES;

  if (
    !file.type.startsWith("image/") &&
    !isVideo
  ) {
    throw new Error(
      "Only image and video files can be uploaded.",
    );
  }

  if (
    file.size <= 0 ||
    file.size > maxBytes
  ) {
    throw new Error(
      isVideo
        ? "Each video must be 100 MB or smaller."
        : "Each image must be 10 MB or smaller.",
    );
  }

  const payload = new FormData();

  payload.append("file", file);
  payload.append(
    "upload_preset",
    uploadPreset,
  );

  payload.append(
    "tags",
    `advance-auto-rentals,vehicle-evidence,${stage}`,
  );

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      cloudName,
    )}/auto/upload`,
    {
      method: "POST",
      body: payload,
    },
  );

  const data = (await response.json()) as {
    secure_url?: string;
    public_id?: string;
    resource_type?: string;
    format?: string;
    bytes?: number;
    original_filename?: string;
    width?: number;
    height?: number;
    duration?: number;
    error?: {
      message?: string;
    };
  };

  if (
    !response.ok ||
    !data.secure_url ||
    !data.public_id
  ) {
    throw new Error(
      data.error?.message ||
        "Cloudinary could not upload the media file.",
    );
  }

  if (
    data.resource_type !== "image" &&
    data.resource_type !== "video"
  ) {
    throw new Error(
      "Cloudinary returned an unsupported media type.",
    );
  }

  return {
    url: data.secure_url,
    publicId: data.public_id,
    resourceType: data.resource_type,
    format:
      data.format ||
      file.type.split("/")[1] ||
      "unknown",
    bytes:
      data.bytes ??
      file.size,
    originalFilename:
      data.original_filename ||
      file.name,
    width: data.width,
    height: data.height,
    duration: data.duration,
  };
}
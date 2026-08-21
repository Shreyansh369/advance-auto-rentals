"use client";

import {
  Camera,
  Check,
  Film,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  uploadVehicleMedia,
  type CloudinaryMedia,
} from "@/lib/cloudinary";

type CameraMode =
  | "photo"
  | "video"
  | null;

export function MediaCapture({
  stage,
  value,
  onChange,
  label = "Vehicle evidence",
  hint = "Capture photos or videos of the vehicle.",
  maxFiles = 20,
}: {
  stage: "booking" | "return";
  value: CloudinaryMedia[];
  onChange: (
    media: CloudinaryMedia[],
  ) => void;
  label?: string;
  hint?: string;
  maxFiles?: number;
}) {
  const videoRef =
    useRef<HTMLVideoElement | null>(
      null,
    );

  const streamRef =
    useRef<MediaStream | null>(
      null,
    );

  const recorderRef =
    useRef<MediaRecorder | null>(
      null,
    );

  const recordedChunksRef =
    useRef<Blob[]>([]);

  const fileInputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const [cameraMode, setCameraMode] =
    useState<CameraMode>(null);

  const [cameraError, setCameraError] =
    useState<string>();

  const [recording, setRecording] =
    useState(false);

  const [uploading, setUploading] =
    useState(false);

  const [uploadError, setUploadError] =
    useState<string>();

  const [recordingSeconds, setRecordingSeconds] =
    useState(0);

  const timerRef =
    useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopCamera();

      if (
        timerRef.current !== null
      ) {
        window.clearInterval(
          timerRef.current,
        );
      }
    };
  }, []);

  function stopCamera() {
    if (recorderRef.current) {
      try {
        if (
          recorderRef.current.state !==
          "inactive"
        ) {
          recorderRef.current.stop();
        }
      } catch {
        // Ignore recorder cleanup errors.
      }

      recorderRef.current =
        null;
    }

    if (
      streamRef.current
    ) {
      streamRef.current
        .getTracks()
        .forEach((track) =>
          track.stop(),
        );

      streamRef.current = null;
    }

    if (
      videoRef.current
    ) {
      videoRef.current.srcObject =
        null;
    }

    setRecording(false);

    if (
      timerRef.current !== null
    ) {
      window.clearInterval(
        timerRef.current,
      );

      timerRef.current = null;
    }

    setRecordingSeconds(0);
  }

  async function openCamera(
    mode: Exclude<
      CameraMode,
      null
    >,
  ) {
    setCameraError(undefined);
    setUploadError(undefined);

    if (
      value.length >= maxFiles
    ) {
      setUploadError(
        `You can attach up to ${maxFiles} files.`,
      );
      return;
    }

    if (
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraError(
        "Camera access is not supported by this browser.",
      );
      return;
    }

    try {
      stopCamera();

      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            video: {
              facingMode:
                mode === "photo"
                  ? "environment"
                  : {
                      ideal:
                        "environment",
                    },

              width: {
                ideal: 1920,
              },

              height: {
                ideal: 1080,
              },
            },

            audio:
              mode === "video",
          },
        );

      streamRef.current =
        stream;

      setCameraMode(mode);

      requestAnimationFrame(
        () => {
          if (
            videoRef.current
          ) {
            videoRef.current.srcObject =
              stream;

            void videoRef.current.play();
          }
        },
      );
    } catch (cause) {
      stopCamera();

      if (
        cause instanceof DOMException &&
        cause.name ===
          "NotAllowedError"
      ) {
        setCameraError(
          "Camera permission was denied. Allow camera access in your browser and try again.",
        );

        return;
      }

      if (
        cause instanceof DOMException &&
        cause.name ===
          "NotFoundError"
      ) {
        setCameraError(
          "No camera was found on this device.",
        );

        return;
      }

      setCameraError(
        "Unable to open the camera. Check your browser permissions and try again.",
      );
    }
  }

  async function uploadBlob(
    blob: Blob,
    filename: string,
  ) {
    setUploadError(undefined);
    setUploading(true);

    try {
      if (
        value.length >= maxFiles
      ) {
        throw new Error(
          `You can attach up to ${maxFiles} files.`,
        );
      }

      const extension =
        blob.type ===
        "video/webm"
          ? "webm"
          : blob.type ===
              "video/mp4"
            ? "mp4"
            : "jpg";

      const file = new File(
        [blob],
        `${filename}.${extension}`,
        {
          type: blob.type,
        },
      );

      const uploaded =
        await uploadVehicleMedia(
          file,
          stage,
        );

      onChange([
        ...value,
        uploaded,
      ]);
    } catch (cause) {
      setUploadError(
        cause instanceof Error
          ? cause.message
          : "Media upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function capturePhoto() {
    const video =
      videoRef.current;

    if (!video) {
      return;
    }

    if (
      !video.videoWidth ||
      !video.videoHeight
    ) {
      setCameraError(
        "Camera is still starting. Try again in a moment.",
      );

      return;
    }

    const canvas =
      document.createElement(
        "canvas",
      );

    canvas.width =
      video.videoWidth;

    canvas.height =
      video.videoHeight;

    const context =
      canvas.getContext("2d");

    if (!context) {
      setCameraError(
        "Unable to capture the camera image.",
      );

      return;
    }

    context.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          setCameraError(
            "Unable to create the photo.",
          );

          return;
        }

        stopCamera();

        await uploadBlob(
          blob,
          `vehicle-${stage}-photo-${Date.now()}`,
        );
      },
      "image/jpeg",
      0.92,
    );
  }

  function getSupportedVideoMimeType() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];

    return candidates.find(
      (type) =>
        typeof MediaRecorder !==
          "undefined" &&
        MediaRecorder.isTypeSupported(
          type,
        ),
    );
  }

  function startVideoRecording() {
    const stream =
      streamRef.current;

    if (!stream) {
      return;
    }

    const mimeType =
      getSupportedVideoMimeType();

    try {
      const recorder =
        mimeType
          ? new MediaRecorder(
              stream,
              {
                mimeType,
              },
            )
          : new MediaRecorder(
              stream,
            );

      recorderRef.current =
        recorder;

      recordedChunksRef.current =
        [];

      recorder.ondataavailable = (
        event,
      ) => {
        if (
          event.data.size > 0
        ) {
          recordedChunksRef.current.push(
            event.data,
          );
        }
      };

      recorder.onstop = () => {
        const blob =
          new Blob(
            recordedChunksRef.current,
            {
              type:
                recorder.mimeType ||
                "video/webm",
            },
          );

        recordedChunksRef.current =
          [];

        void uploadBlob(
          blob,
          `vehicle-${stage}-video-${Date.now()}`,
        );

        stopCamera();
      };

      recorder.start(250);

      setRecording(true);
      setRecordingSeconds(0);

      timerRef.current =
        window.setInterval(
          () => {
            setRecordingSeconds(
              (seconds) =>
                seconds + 1,
            );
          },
          1000,
        );
    } catch {
      setCameraError(
        "This browser cannot record video from the selected camera.",
      );
    }
  }

  function stopVideoRecording() {
    const recorder =
      recorderRef.current;

    if (!recorder) {
      return;
    }

    if (
      recorder.state !==
      "inactive"
    ) {
      recorder.stop();
    }

    setRecording(false);
  }

  function formatTime(
    seconds: number,
  ) {
    const minutes =
      Math.floor(
        seconds / 60,
      );

    const remainder =
      seconds % 60;

    return `${String(
      minutes,
    ).padStart(
      2,
      "0",
    )}:${String(
      remainder,
    ).padStart(
      2,
      "0",
    )}`;
  }

  async function handleFiles(
    files: FileList | null,
  ) {
    if (!files?.length) {
      return;
    }

    setUploadError(undefined);
    setUploading(true);

    try {
      const remaining =
        Math.max(
          0,
          maxFiles -
            value.length,
        );

      if (!remaining) {
        throw new Error(
          `You can attach up to ${maxFiles} files.`,
        );
      }

      const selected =
        Array.from(
          files,
        ).slice(
          0,
          remaining,
        );

      const uploaded: CloudinaryMedia[] =
        [];

      for (const file of selected) {
        uploaded.push(
          await uploadVehicleMedia(
            file,
            stage,
          ),
        );
      }

      onChange([
        ...value,
        ...uploaded,
      ]);
    } catch (cause) {
      setUploadError(
        cause instanceof Error
          ? cause.message
          : "Media upload failed.",
      );
    } finally {
      setUploading(false);

      if (
        fileInputRef.current
      ) {
        fileInputRef.current.value =
          "";
      }
    }
  }

  return (
    <>
      <div className="media-capture">
        <div className="media-capture-heading">
          <div>
            <label className="media-label">
              {label}
            </label>

            <p className="media-hint">
              {hint}
            </p>
          </div>

          <span className="media-count">
            {value.length}/{maxFiles}
          </span>
        </div>

        <div className="media-actions">
          <button
            className="button button-secondary compact"
            type="button"
            disabled={
              uploading ||
              value.length >=
                maxFiles
            }
            onClick={() =>
              void openCamera(
                "photo",
              )
            }
          >
            <Camera
              size={16}
            />
            Take photo
          </button>

          <button
            className="button button-secondary compact"
            type="button"
            disabled={
              uploading ||
              value.length >=
                maxFiles
            }
            onClick={() =>
              void openCamera(
                "video",
              )
            }
          >
            <Film
              size={16}
            />
            Record video
          </button>

          <button
            className="button button-secondary compact"
            type="button"
            disabled={
              uploading ||
              value.length >=
                maxFiles
            }
            onClick={() =>
              fileInputRef.current?.click()
            }
          >
            <ImagePlus
              size={16}
            />
            Choose files
          </button>
        </div>

        <input
          ref={fileInputRef}
          className="media-input"
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(event) =>
            void handleFiles(
              event.target.files,
            )
          }
        />

        {cameraError && (
          <div className="media-error">
            {cameraError}
          </div>
        )}

        {uploadError && (
          <div className="media-error">
            {uploadError}
          </div>
        )}

        {uploading && (
          <div className="media-uploading">
            <LoaderCircle
              className="spin"
              size={16}
            />
            Uploading media...
          </div>
        )}

        {value.length > 0 && (
          <div className="media-list">
            {value.map((media) => (
              <div
                className="media-item"
                key={`${media.publicId}-${media.url}`}
              >
                {media.resourceType ===
                "video" ? (
                  <video
                    src={media.url}
                    controls
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={media.url}
                    alt={
                      media.originalFilename
                    }
                  />
                )}

                <div className="media-item-footer">
                  <span
                    title={
                      media.originalFilename
                    }
                  >
                    {
                      media.originalFilename
                    }
                  </span>

                  <button
                    className="icon-button media-remove"
                    type="button"
                    aria-label={`Remove ${media.originalFilename}`}
                    onClick={() =>
                      onChange(
                        value.filter(
                          (item) =>
                            item.url !==
                            media.url,
                        ),
                      )
                    }
                  >
                    <X
                      size={15}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {cameraMode && (
        <div
          className="camera-modal-backdrop"
          role="presentation"
        >
          <section
            className="camera-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              cameraMode ===
              "photo"
                ? "Take vehicle photo"
                : "Record vehicle video"
            }
          >
            <header className="camera-modal-header">
              <div>
                <span>
                  {cameraMode ===
                  "photo"
                    ? "PHOTO CAPTURE"
                    : "VIDEO CAPTURE"}
                </span>

                <h3>
                  {cameraMode ===
                  "photo"
                    ? "Capture vehicle photo"
                    : "Record vehicle video"}
                </h3>
              </div>

              <button
                className="icon-button"
                type="button"
                onClick={() => {
                  stopCamera();
                  setCameraMode(
                    null,
                  );
                }}
                aria-label="Close camera"
              >
                <X size={19} />
              </button>
            </header>

            <div className="camera-preview">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
              />

              {cameraMode ===
                "video" &&
                recording && (
                  <div className="camera-recording-indicator">
                    <span />
                    REC{" "}
                    {formatTime(
                      recordingSeconds,
                    )}
                  </div>
                )}

              {recording && (
                <div className="camera-recording-banner">
                  Recording in progress
                </div>
              )}
            </div>

            <footer className="camera-controls">
              {cameraMode ===
                "photo" && (
                <button
                  className="camera-main-button"
                  type="button"
                  onClick={() =>
                    void capturePhoto()
                  }
                  disabled={
                    uploading
                  }
                  aria-label="Capture photo"
                >
                  <Camera
                    size={25}
                  />
                </button>
              )}

              {cameraMode ===
                "video" &&
                !recording && (
                  <button
                    className="camera-main-button camera-video-button"
                    type="button"
                    onClick={
                      startVideoRecording
                    }
                    disabled={
                      uploading
                    }
                    aria-label="Start recording"
                  >
                    <Film
                      size={25}
                    />
                  </button>
                )}

              {cameraMode ===
                "video" &&
                recording && (
                  <button
                    className="camera-main-button camera-stop-button"
                    type="button"
                    onClick={
                      stopVideoRecording
                    }
                    aria-label="Stop recording"
                  >
                    <Square
                      size={24}
                      fill="currentColor"
                    />
                  </button>
                )}

              {!recording && (
                <button
                  className="camera-secondary-button"
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setCameraMode(
                      null,
                    );
                  }}
                >
                  <RotateCcw
                    size={17}
                  />
                  Cancel
                </button>
              )}

              {recording && (
                <div className="camera-recording-status">
                  <span>
                    <span />
                    Recording
                  </span>

                  <strong>
                    {formatTime(
                      recordingSeconds,
                    )}
                  </strong>
                </div>
              )}
            </footer>

            {!recording &&
              cameraMode ===
                "photo" && (
                <div className="camera-help">
                  Position the vehicle
                  inside the frame and
                  press the camera button.
                </div>
              )}

            {!recording &&
              cameraMode ===
                "video" && (
                <div className="camera-help">
                  Press the video button to
                  start recording. Press it
                  again to finish.
                </div>
              )}
          </section>
        </div>
      )}
    </>
  );
}
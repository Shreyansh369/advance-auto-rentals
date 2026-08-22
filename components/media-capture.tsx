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
    };
  }, []);

  function stopCamera() {
    const recorder =
      recorderRef.current;

    if (
      recorder &&
      recorder.state !== "inactive"
    ) {
      try {
        recorder.stop();
      } catch {
        // Recorder may already have stopped.
      }
    }

    recorderRef.current = null;

    const stream =
      streamRef.current;

    if (stream) {
      stream
        .getTracks()
        .forEach((track) =>
          track.stop(),
        );

      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();

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

  function closeCamera() {
    stopCamera();
    setCameraMode(null);
    setCameraError(undefined);
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

      /*
       * Keep the camera request deliberately
       * conservative. Mobile browsers, especially
       * Safari, may reject overly-specific constraints.
       */
      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            video: {
              facingMode: {
                ideal:
                  "environment",
              },
              width: {
                ideal: 1280,
              },
              height: {
                ideal: 720,
              },
            },
            audio:
              mode === "video",
          },
        );

      streamRef.current =
        stream;

      setCameraMode(mode);

      /*
       * Wait until the video element has been
       * mounted before assigning the stream.
       */
      requestAnimationFrame(() => {
        const video =
          videoRef.current;

        if (!video) {
          return;
        }

        video.srcObject =
          stream;

        video.muted = true;
        video.playsInline = true;

        void video
          .play()
          .catch(() => {
            /*
             * Safari may require another user gesture.
             * The stream itself remains attached.
             */
          });
      });
    } catch (cause) {
      stopCamera();

      if (
        cause instanceof DOMException &&
        cause.name ===
          "NotAllowedError"
      ) {
        setCameraError(
          "Camera permission was denied. Allow camera access in your browser settings and try again.",
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

      if (
        cause instanceof DOMException &&
        (
          cause.name ===
            "NotReadableError" ||
          cause.name ===
            "AbortError"
        )
      ) {
        setCameraError(
          "The camera is currently being used by another application or could not be opened. Close other camera apps and try again.",
        );
        return;
      }

      setCameraError(
        "Unable to open the camera. Check browser permissions and try again.",
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

        closeCamera();

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
    if (
      typeof MediaRecorder ===
      "undefined"
    ) {
      return undefined;
    }

    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];

    return candidates.find(
      (type) =>
        MediaRecorder.isTypeSupported(
          type,
        ),
    );
  }

  function startVideoRecording() {
    const stream =
      streamRef.current;

    if (!stream) {
      setCameraError(
        "Camera is not ready yet.",
      );
      return;
    }

    if (
      typeof MediaRecorder ===
      "undefined"
    ) {
      setCameraError(
        "Video recording is not supported by this browser.",
      );
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

      recorder.ondataavailable =
        (event) => {
          if (
            event.data.size > 0
          ) {
            recordedChunksRef.current.push(
              event.data,
            );
          }
        };

      recorder.onerror = () => {
        setCameraError(
          "Video recording failed. Please try again.",
        );
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

        /*
         * Upload first, then clean up the camera.
         * This avoids racing MediaRecorder cleanup
         * on mobile Safari.
         */
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
      try {
        recorder.stop();
      } catch {
        setCameraError(
          "Unable to stop the video recording cleanly.",
        );
      }
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

      for (
        const file of selected
      ) {
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
          <div
            className="media-error"
            role="alert"
          >
            {cameraError}
          </div>
        )}

        {uploadError && (
          <div
            className="media-error"
            role="alert"
          >
            {uploadError}
          </div>
        )}

        {uploading && (
          <div
            className="media-uploading"
            role="status"
            aria-live="polite"
          >
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
                    playsInline
                  />
                ) : (
                  <img
                    src={media.url}
                    alt={
                      media.originalFilename
                    }
                    loading="lazy"
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
                onClick={
                  closeCamera
                }
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
                  onClick={
                    closeCamera
                  }
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
                  Press the video button
                  to start recording.
                  Press it again to finish.
                </div>
              )}
          </section>
        </div>
      )}
    </>
  );
}
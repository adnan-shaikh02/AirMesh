import { useEffect, useRef, useState } from "react";
import { useDrop } from "./useDrop";
import "./App.css";

type IconName =
  | "send"
  | "receive"
  | "shield"
  | "sun"
  | "moon"
  | "plus"
  | "folder"
  | "file"
  | "arrow"
  | "check"
  | "link"
  | "device"
  | "close";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    send: (
      <>
        <path d="M22 2 11 13" />
        <path d="m22 2-7 20-4-9-9-4Z" />
      </>
    ),
    receive: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </>
    ),
    moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />,
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    folder: (
      <>
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <path d="M3 10h18" />
      </>
    ),
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8m-8 4h8" />
      </>
    ),
    arrow: (
      <>
        <path d="M7 17 17 7M7 7h10v10" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>
    ),
    device: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8m-4-4v4" />
      </>
    ),
    close: (
      <>
        <path d="m18 6-12 12M6 6l12 12" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const drop = useDrop();
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("drop-theme") === "dark" ? "dark" : "light",
  );
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const selected = Array.from(list);
    if (drop.phase === "connected") {
      drop.sendFiles(selected);
      setNotice(
        `${selected.length} ${selected.length === 1 ? "file" : "files"} added to the transfer queue`,
      );
      return;
    }
    setFiles((current) => [...current, ...selected]);
  };
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("drop-theme", next);
  };
  const startPairing = () => drop.createRoom();

  return (
    <div className={`app-shell ${theme}`}>
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Drop home">
          <span className="brand-mark">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>
            drop<span className="brand-period">.</span>
          </span>
        </a>
        <nav className="top-nav" aria-label="Main navigation">
          <a className="nav-active" href="#home">
            Transfer
          </a>
          <a href="#how">How it works</a>
        </nav>
        <div className="top-actions">
          <span className="privacy-pill">
            <Icon name="shield" size={15} /> Private by design
          </span>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            <Icon name={theme === "light" ? "moon" : "sun"} size={18} />
          </button>
          <button className="avatar" aria-label="Guest profile">
            G
          </button>
        </div>
      </header>

      <main id="home">
        <section className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> THE SIMPLE WAY TO SHARE
          </div>
          <h1>
            Send files.
            <br />
            <em>Not through the cloud.</em>
          </h1>
          <p>
            Fast, private transfers that go straight from your device to theirs.
          </p>
        </section>

        <section
          className={`transfer-card ${dragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
        >
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <div className="card-topline">
            <div className="secure-label">
              <span className="secure-icon">
                <Icon name="shield" size={16} />
              </span>
              <span>End-to-end encrypted</span>
            </div>
            <span className="direct-label">
              <i /> DIRECT CONNECTION
            </span>
          </div>
          <div className="transfer-grid">
            <div className="send-panel">
              <div className="panel-heading">
                <div>
                  <span className="step-label">01 / SEND</span>
                  <h2>Choose your files</h2>
                  <p>Drop them here, or pick from your device.</p>
                </div>
                <span className="round-icon violet">
                  <Icon name="send" size={19} />
                </span>
              </div>
              <button
                className="drop-zone"
                onClick={() => picker.current?.click()}
              >
                <span className="upload-symbol">
                  <Icon name="plus" size={23} />
                </span>
                <strong>
                  {dragging ? "Drop your files" : "Add files to send"}
                </strong>
                <span>
                  Browse files <span className="subtle">or drag & drop</span>
                </span>
                <small>Large files supported · browser limits apply</small>
              </button>
              {files.length > 0 && (
                <div className="selected-files">
                  <div className="files-heading">
                    <span>
                      {files.length} {files.length === 1 ? "file" : "files"}{" "}
                      selected
                    </span>
                    <button onClick={() => setFiles([])}>Clear all</button>
                  </div>
                  {files.map((file, index) => (
                    <div className="file-row" key={`${file.name}-${index}`}>
                      <span className="file-icon">
                        <Icon name="file" size={17} />
                      </span>
                      <span className="file-name">
                        {file.name}
                        <small>{formatSize(file.size)}</small>
                      </span>
                      <button
                        className="remove-file"
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          setFiles((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="primary-button"
                onClick={() => {
                  if (drop.phase === "connected" || drop.phase === "waiting") {
                    if (files.length) drop.sendFiles(files);
                    setFiles([]);
                  } else startPairing();
                }}
              >
                <span>
                  {drop.phase === "connected"
                    ? files.length
                      ? `Send ${files.length} ${files.length === 1 ? "file" : "files"}`
                      : "Select files to send"
                    : drop.phase === "waiting"
                      ? "Waiting for device…"
                      : "Create secure room"}
                </span>
                <Icon name="arrow" size={17} />
              </button>
              {drop.transfers.map((transfer, index) => (
                <div
                  className="transfer-progress"
                  key={`${transfer.name}-${index}`}
                >
                  <div className="transfer-progress-top">
                    <span>
                      {transfer.direction === "send" ? "Sending" : "Receiving"}{" "}
                      {transfer.name}
                    </span>
                    <span>
                      {transfer.status === "complete"
                        ? "Complete"
                        : transfer.status === "waiting"
                          ? "Waiting for approval"
                          : transfer.status}
                    </span>
                  </div>
                  <div className="progress-track">
                    <i
                      style={{
                        width: `${transfer.size ? Math.min(100, (transfer.received / transfer.size) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <div className="transfer-progress-bottom">
                    <span>
                      {formatSize(transfer.received)} of{" "}
                      {formatSize(transfer.size)}
                    </span>
                    <span>
                      {transfer.speed ? `${formatSize(transfer.speed)}/s` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="divider">
              <span>OR</span>
            </div>
            <div className="receive-panel">
              <div className="panel-heading">
                <div>
                  <span className="step-label">02 / RECEIVE</span>
                  <h2>Connect a device</h2>
                  <p>Scan a QR code or enter a pairing code.</p>
                </div>
                <span className="round-icon mint">
                  <Icon name="receive" size={19} />
                </span>
              </div>
              <div className="pair-box">
                <div className="pair-visual">
                  {drop.qr ? (
                    <img
                      className="real-qr"
                      src={drop.qr}
                      alt="Scan to join this Drop room"
                    />
                  ) : (
                    <div className="qr-placeholder">
                      <span className="qr-placeholder-icon">
                        <Icon name="link" size={23} />
                      </span>
                      <span>
                        {drop.phase === "waiting"
                          ? "Creating secure room…"
                          : "Create a room to show QR"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="pair-caption">
                  <span
                    className={
                      drop.phase === "connected" ? "live-dot" : "waiting-dot"
                    }
                  />
                  {drop.phase === "connected"
                    ? "Device connected securely"
                    : drop.phase === "waiting"
                      ? "Waiting for a device to join"
                      : "Pairing ready when you are"}
                </div>
                <button
                  className="copy-link"
                  onClick={() => {
                    if (drop.pairCode) {
                      void navigator.clipboard?.writeText(drop.pairCode);
                      setNotice("Pairing code copied");
                    } else startPairing();
                  }}
                >
                  <Icon name="link" size={15} />
                  {drop.pairCode
                    ? "Copy manual pairing code"
                    : "Create a pairing room"}
                </button>
              </div>
              <div className="manual-row">
                <span>Can’t scan the code?</span>
                <button onClick={() => setManual((value) => !value)}>
                  {manual ? "Close" : "Enter code"}{" "}
                  <Icon name="arrow" size={13} />
                </button>
              </div>
              {manual && (
                <form
                  className="manual-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    drop.joinRoom(code);
                  }}
                >
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value.trim())}
                    placeholder="Paste pairing link or code"
                    aria-label="Pairing code"
                  />
                  <button type="submit" aria-label="Connect with code">
                    <Icon name="arrow" size={17} />
                  </button>
                </form>
              )}
            </div>
          </div>
          <div className="card-footer">
            <span>
              <Icon name="device" size={16} /> No account needed
            </span>
            <span>
              <Icon name="shield" size={16} /> Files never touch our servers
            </span>
            <span>
              <Icon name="check" size={16} /> Works across your devices
            </span>
          </div>
        </section>

        <section className="below-grid" id="how">
          <div className="connected-card">
            <div className="section-heading">
              <div>
                <span className="section-kicker">YOUR DEVICES</span>
                <h3>Connected devices</h3>
              </div>
              <span className="count-badge">
                {drop.phase === "connected" ? "1" : "0"}
              </span>
            </div>
            <div className="empty-state">
              {drop.phase === "connected" ? (
                <>
                  <span className="empty-device">
                    <Icon name="device" size={23} />
                  </span>
                  <strong>{drop.peerName || "Connected device"}</strong>
                  <span>Ready to transfer directly.</span>
                </>
              ) : (
                <>
                  <span className="empty-device">
                    <Icon name="device" size={23} />
                  </span>
                  <strong>No devices connected yet</strong>
                  <span>Pair a device to start sharing files.</span>
                </>
              )}
            </div>
            <div className="device-footnote">
              <span className="online-indicator" /> Devices appear here when
              connected
            </div>
          </div>
        </section>
        <footer className="page-footer">
          <span>© 2025 Drop. A little more private.</span>
          <span>
            <span className="footer-lock">
              <Icon name="shield" size={13} />
            </span>{" "}
            Peer-to-peer by design
          </span>
          <a href="#how">
            How it works <Icon name="arrow" size={13} />
          </a>
        </footer>
      </main>
      {drop.error && (
        <div className="connection-error" role="alert">
          {drop.error}
        </div>
      )}
      {drop.incoming && (
        <div className="modal-backdrop">
          <section
            className="pair-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="incoming-title"
          >
            <span className="round-icon mint modal-icon">
              <Icon name="receive" />
            </span>
            <span className="step-label">INCOMING TRANSFER</span>
            <h2 id="incoming-title">Accept this file?</h2>
            <p>
              <strong>{drop.incoming.name}</strong>
              <br />
              {formatSize(drop.incoming.size)} · sent directly from the
              connected device
            </p>
            <div className="incoming-actions">
              <button onClick={() => drop.respondToIncoming(false)}>
                Decline
              </button>
              <button onClick={() => void drop.respondToIncoming(true)}>
                Accept file
              </button>
            </div>
          </section>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

export default App;

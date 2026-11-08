import { useEffect, useRef, useState } from "react";
import { useDrop } from "../utils/useDrop";
import { Icon } from "./Icon";
import labels from "../config/labels.json";
import "../styles/App.css";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(0)} ${labels.units.kilobytes}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${labels.units.megabytes}`;
}

const interpolate = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
const transferStatusLabels: Record<string, string> = labels.transferStatus;

function MainContent() {
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
        interpolate(
          selected.length === 1 ? labels.transfer.queuedSingular : labels.transfer.queuedPlural,
          { count: selected.length },
        ),
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
        <a className="brand" href="#home" aria-label={labels.accessibility.home}>
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <span>
            {labels.brand}<span className="brand-period">.</span>
          </span>
        </a>
        <nav className="top-nav" aria-label={labels.accessibility.mainNavigation}></nav>
        <div className="top-actions">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={interpolate(labels.accessibility.switchTheme, { theme: theme === "light" ? labels.theme.dark : labels.theme.light })}
          >
            <Icon name={theme === "light" ? "moon" : "sun"} size={18} />
          </button>
        </div>
      </header>

      <main id="home">
        <section className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> {labels.hero.eyebrow}
          </div>
          <h1>
            {labels.hero.title}
            <br />
            <em>{labels.hero.subtitle}</em>
          </h1>
          <p>
            {labels.hero.description}
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
              <span>{labels.transfer.encrypted}</span>
            </div>
            <span className="direct-label">
              <i /> {labels.transfer.directConnection}
            </span>
          </div>
          <div className="transfer-grid">
            <div className="send-panel">
              <div className="panel-heading">
                <div>
                  <span className="step-label">{labels.transfer.sendStep}</span>
                  <h2>{labels.transfer.chooseFiles}</h2>
                  <p>{labels.transfer.chooseFilesHelp}</p>
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
                  {dragging ? labels.transfer.dropFiles : labels.transfer.addFiles}
                </strong>
                <span>
                  {labels.transfer.browseFiles} <span className="subtle">{labels.transfer.dragDrop}</span>
                </span>
                <small>{labels.transfer.largeFilesNote}</small>
              </button>
              {files.length > 0 && (
                <div className="selected-files">
                  <div className="files-heading">
                    <span>
                      {interpolate(files.length === 1 ? labels.transfer.selectedSingular : labels.transfer.selectedPlural, { count: files.length })}
                    </span>
                    <button onClick={() => setFiles([])}>{labels.transfer.clearAll}</button>
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
                        aria-label={interpolate(labels.accessibility.removeFile, { file: file.name })}
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
                      ? interpolate(files.length === 1 ? labels.transfer.sendSingular : labels.transfer.sendPlural, { count: files.length })
                      : labels.transfer.selectFilesToSend
                    : drop.phase === "waiting"
                      ? labels.transfer.waitingForDevice
                      : labels.transfer.createSecureRoom}
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
                      {transfer.direction === "send" ? labels.transfer.sending : labels.transfer.receiving}{" "}
                      {transfer.name}
                    </span>
                    <span>
                      {transfer.status === "complete"
                        ? labels.transfer.complete
                        : transfer.status === "waiting"
                          ? labels.transfer.waitingForApproval
                        : transferStatusLabels[transfer.status] ?? transfer.status}
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
              <span>{labels.transfer.or}</span>
            </div>
            <div className="receive-panel">
              <div className="panel-heading">
                <div>
                  <span className="step-label">{labels.transfer.receiveStep}</span>
                  <h2>{labels.transfer.connectDevice}</h2>
                  <p>{labels.transfer.connectHelp}</p>
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
                      alt={labels.accessibility.qrCode}
                    />
                  ) : (
                    <div className="qr-placeholder">
                      <span className="qr-placeholder-icon">
                        <Icon name="link" size={23} />
                      </span>
                      <span>
                        {drop.phase === "waiting"
                          ? labels.transfer.creatingRoom
                          : labels.transfer.createRoomForQr}
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
                    ? labels.transfer.deviceConnected
                    : drop.phase === "waiting"
                      ? labels.transfer.waitingToJoin
                      : labels.transfer.pairingReady}
                </div>
                <button
                  className="copy-link"
                  onClick={() => {
                    if (drop.pairCode) {
                      void navigator.clipboard?.writeText(drop.pairCode);
                      setNotice(labels.transfer.pairingCodeCopied);
                    } else startPairing();
                  }}
                >
                  <Icon name="link" size={15} />
                  {drop.pairCode
                    ? labels.transfer.copyPairingCode
                    : labels.transfer.createPairingRoom}
                </button>
              </div>
              <div className="manual-row">
                <span>{labels.transfer.cannotScan}</span>
                <button onClick={() => setManual((value) => !value)}>
                  {manual ? labels.transfer.close : labels.transfer.enterCode}{" "}
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
                    placeholder={labels.transfer.pairingPlaceholder}
                    aria-label={labels.accessibility.pairingCode}
                  />
                  <button type="submit" aria-label={labels.accessibility.connectWithCode}>
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
                <span className="section-kicker">{labels.devices.section}</span>
                <h3>{labels.devices.title}</h3>
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
                  <strong>{drop.peerName || labels.devices.connectedDevice}</strong>
                  <span>{labels.devices.ready}</span>
                </>
              ) : (
                <>
                  <span className="empty-device">
                    <Icon name="device" size={23} />
                  </span>
                  <strong>{labels.devices.none}</strong>
                  <span>{labels.devices.pairPrompt}</span>
                </>
              )}
            </div>
            <div className="device-footnote">
              <span className="online-indicator" /> {labels.devices.footnote}
            </div>
          </div>
        </section>
        <footer className="page-footer">
          <span>{labels.footer.copyright}</span>
          <span>
            <span className="footer-lock">
              <Icon name="shield" size={13} />
            </span>{" "}
            {labels.footer.peerToPeer}
          </span>
          <span>{labels.footer.author}</span>
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
            <span className="step-label">{labels.incoming.step}</span>
            <h2 id="incoming-title">{labels.incoming.title}</h2>
            <p>
              <strong>{drop.incoming.name}</strong>
              <br />
              {interpolate(labels.incoming.description, { size: formatSize(drop.incoming.size) })}
            </p>
            <div className="incoming-actions">
              <button onClick={() => drop.respondToIncoming(false)}>
                {labels.incoming.decline}
              </button>
              <button onClick={() => void drop.respondToIncoming(true)}>
                {labels.incoming.accept}
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

export default MainContent;

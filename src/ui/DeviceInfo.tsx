import type { DeviceProfile } from '../sim/devices/types';

function maxFps(d: DeviceProfile): number {
  const bytes = d.tech === 'lcd' ? d.width * d.height * 2 : (d.width * d.height) / 8;
  const bits = d.bus.kind === 'i2c' ? bytes * 9 * 1.06 : bytes * 8;
  return d.bus.hz / bits;
}

export function DeviceInfo({ device }: { device: DeviceProfile }) {
  const diag = Math.hypot(device.look.activeWidthMm, device.look.activeHeightMm) / 25.4;
  const bus =
    device.bus.kind === 'spi'
      ? `SPI @ ${device.bus.hz / 1e6} MHz`
      : `I2C @ ${device.bus.hz / 1e3} kHz, addr 0x${(device.bus.i2cAddress ?? 0x3c).toString(16)}`;
  return (
    <div className="panel">
      <h2>Device</h2>
      <table className="readout">
        <tbody>
          <tr>
            <th>panel</th>
            <td>
              {device.tech.toUpperCase()} · {device.width}×{device.height} · {diag.toFixed(2)}″
            </td>
          </tr>
          <tr>
            <th>controller</th>
            <td>{device.controller}</td>
          </tr>
          <tr>
            <th>bus</th>
            <td>{bus}</td>
          </tr>
          {device.ram && (
            <tr>
              <th>RAM window</th>
              <td>
                {device.ram.width}×{device.ram.height}, visible at x+{device.ram.offsetX}, y+{device.ram.offsetY}
              </td>
            </tr>
          )}
          <tr>
            <th>full frame</th>
            <td>
              {device.epaper
                ? `${device.epaper.fullRefreshMs} ms full / ${device.epaper.partialRefreshMs} ms partial refresh`
                : `≤ ${Math.floor(maxFps(device))} fps over the bus`}
            </td>
          </tr>
        </tbody>
      </table>
      {device.wiring && (
        <>
          <h3>Wiring</h3>
          <div className="pins">
            {Object.entries(device.wiring).map(([fn, gpio]) => (
              <span key={fn} className="pin">
                {fn} <b>GPIO{gpio}</b>
              </span>
            ))}
          </div>
        </>
      )}
      {device.porting && (
        <>
          <h3>Porting notes</h3>
          <ul className="notes">
            {device.porting.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
      {device.url && (
        <a href={device.url} target="_blank" rel="noreferrer">
          Manufacturer docs ↗
        </a>
      )}
    </div>
  );
}

import type { ReactNode } from 'react';
import type { DeviceProfile } from '../sim/devices/types';

function maxFps(d: DeviceProfile): number {
  const n = d.width * d.height;
  if (d.tech === 'led') return 1000 / (((n * 24) / d.bus.hz) * 1000 + 0.3);
  const bytes = d.tech === 'lcd' ? n * 2 : n / 8;
  const bits = d.bus.kind === 'i2c' ? bytes * 9 * 1.06 : bytes * 8;
  return d.bus.hz / bits;
}

/** The display module: a picker (children), its specs, and the wiring and porting notes folded away. */
export function DeviceInfo({ device, children }: { device: DeviceProfile; children?: ReactNode }) {
  const diag = Math.hypot(device.look.activeWidthMm, device.look.activeHeightMm) / 25.4;
  const bus =
    device.bus.kind === 'ws2812'
      ? `one wire @ ${device.bus.hz / 1e3} kHz, GRB 24 bit/LED`
      : device.bus.kind === 'spi'
        ? `SPI @ ${device.bus.hz / 1e6} MHz`
        : `I2C @ ${device.bus.hz / 1e3} kHz, addr 0x${(device.bus.i2cAddress ?? 0x3c).toString(16)}`;
  const leds = device.look.leds;
  return (
    <div className="display-info">
      {children}
      <table className="readout">
        <tbody>
          <tr>
            <th>{leds ? 'LEDs' : 'panel'}</th>
            <td>
              {leds
                ? `${device.width * device.height} · ${leds.layout === 'grid' ? `${device.width}×${device.height} grid` : leds.layout} · ${leds.pitchMm.toFixed(1)} mm apart`
                : `${device.tech.toUpperCase()} · ${device.width}×${device.height} · ${diag.toFixed(2)}″`}
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
      {(device.wiring || device.porting || device.url) && (
        <details className="display-more">
          <summary>Wiring and porting notes</summary>
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
        </details>
      )}
    </div>
  );
}

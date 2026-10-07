import base from './waveshare-esp32-s3-amoled-1.91';
import type { DeviceProfile } from './types';

// The same board as the ESP32-S3-AMOLED-1.91 with an FT3168 touch panel over the glass.
export default {
  ...base,
  id: 'waveshare-esp32-s3-touch-amoled-1.91',
  name: 'Waveshare ESP32-S3-Touch-AMOLED-1.91',
  touch: { controller: 'FT3168', i2cAddress: 0x38 },
  wiring: { ...base.wiring, 'Touch INT': 41 },
  porting: [
    ...base.porting,
    'Touch: FT3168 at I2C 0x38 on the shared bus (SDA 40, SCL 39), INT on GPIO41; per the schematic its reset is tied to the panel\'s RST (GPIO17). It reports one finger in native (portrait) panel pixels: rotate the point to landscape before handing it to apps. Expose it as Bench\'s `touchscreen` module and `touch_*` events.',
  ],
  url: 'https://docs.waveshare.com/ESP32-S3-AMOLED-1.91',
} satisfies DeviceProfile;

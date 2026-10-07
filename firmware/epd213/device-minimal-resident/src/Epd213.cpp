// Sequences follow Waveshare's epd2in13_V2 and GxEPD2's GDEH0213B72 drivers.
#include "Epd213.h"

// Waveshare epd2in13_V2 tables: 70 bytes of waveform, then gate voltage,
// three source voltages, dummy line and gate time.
static const uint8_t LUT_FULL[76] = {
  0x80,0x60,0x40,0x00,0x00,0x00,0x00,  // LUT0: BB
  0x10,0x60,0x20,0x00,0x00,0x00,0x00,  // LUT1: BW
  0x80,0x60,0x40,0x00,0x00,0x00,0x00,  // LUT2: WB
  0x10,0x60,0x20,0x00,0x00,0x00,0x00,  // LUT3: WW
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,  // LUT4: VCOM
  0x03,0x03,0x00,0x00,0x02,            // TP0 A..D, RP0
  0x09,0x09,0x00,0x00,0x02,
  0x03,0x03,0x00,0x00,0x02,
  0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,
  0x15,0x41,0xA8,0x32,0x30,0x0A,
};

static const uint8_t LUT_PARTIAL[70] = {
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,  // BB: no change
  0x80,0x00,0x00,0x00,0x00,0x00,0x00,  // BW
  0x40,0x00,0x00,0x00,0x00,0x00,0x00,  // WB
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,  // WW: no change
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,  // VCOM
  0x0A,0x00,0x00,0x00,0x00,            // 10 frames, once
  0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,
  0x00,0x00,0x00,0x00,0x00,
};

void Epd213::begin(uint32_t spiHz) {
  pinMode(_p.cs, OUTPUT);
  pinMode(_p.dc, OUTPUT);
  pinMode(_p.rst, OUTPUT);
  pinMode(_p.busy, INPUT);
  digitalWrite(_p.cs, HIGH);
  _settings = SPISettings(spiHz, MSBFIRST, SPI_MODE0);
  _spi.begin(_p.clk, -1, _p.din, _p.cs);  // write-only: no MISO
  reset();
  waitBusy();
  cmd(0x12);                       // software reset
  waitBusy();
  _haveBase = false;
  _partMode = false;
  _partials = 0;
}

void Epd213::reset() {
  digitalWrite(_p.rst, HIGH); delay(20);
  digitalWrite(_p.rst, LOW);  delay(2);
  digitalWrite(_p.rst, HIGH); delay(20);
}

void Epd213::waitBusy(uint32_t timeoutMs) {
  uint32_t t0 = millis();
  while (busy()) {
    if (millis() - t0 > timeoutMs) {
      Serial.println("[epd] BUSY timeout");
      return;
    }
    delay(1);
  }
}

void Epd213::cmd(uint8_t c) {
  _spi.beginTransaction(_settings);
  digitalWrite(_p.dc, LOW);
  digitalWrite(_p.cs, LOW);
  _spi.transfer(c);
  digitalWrite(_p.cs, HIGH);
  _spi.endTransaction();
}

void Epd213::data(uint8_t d) { dataBuf(&d, 1); }

void Epd213::dataBuf(const uint8_t* buf, size_t n) {
  _spi.beginTransaction(_settings);
  digitalWrite(_p.dc, HIGH);
  digitalWrite(_p.cs, LOW);
  _spi.writeBytes(buf, n);
  digitalWrite(_p.cs, HIGH);
  _spi.endTransaction();
}

void Epd213::setWindowAndCursor() {
  cmd(0x44);                       // RAM X window, in bytes: 0..15
  data(0x00);
  data((WIDTH - 1) >> 3);
  cmd(0x45);                       // RAM Y window: 0..249
  data(0x00); data(0x00);
  data((HEIGHT - 1) & 0xFF); data((HEIGHT - 1) >> 8);
  cmd(0x4E); data(0x00);           // X cursor
  cmd(0x4F); data(0x00); data(0x00);  // Y cursor
}

void Epd213::writeRam(uint8_t reg, const uint8_t* frame) {
  setWindowAndCursor();
  cmd(reg);
  dataBuf(frame, FRAME_BYTES);
}

void Epd213::powerOn() {
  cmd(0x22); data(0xC0);           // clock + analog on, stay on
  cmd(0x20);
  waitBusy();
}

void Epd213::initFull() {
  cmd(0x74); data(0x54);           // analog block control
  cmd(0x7E); data(0x3B);           // digital block control
  cmd(0x01);                       // driver output: 250 gates
  data((HEIGHT - 1) & 0xFF); data((HEIGHT - 1) >> 8); data(0x00);
  cmd(0x11); data(0x03);           // data entry: X+, Y+
  cmd(0x3C); data(0x03);           // border waveform
  cmd(0x2C); data(0x55);           // VCOM
  cmd(0x03); data(LUT_FULL[70]);   // gate voltage
  cmd(0x04); dataBuf(&LUT_FULL[71], 3);  // source voltages
  cmd(0x3A); data(LUT_FULL[74]);   // dummy line
  cmd(0x3B); data(LUT_FULL[75]);   // gate time
  cmd(0x32); dataBuf(LUT_FULL, 70);
  powerOn();
  _partMode = false;
}

void Epd213::initPartial() {
  cmd(0x2C); data(0x26);           // VCOM for partial
  cmd(0x32); dataBuf(LUT_PARTIAL, sizeof LUT_PARTIAL);
  cmd(0x3C); data(0x01);           // border: hold
  powerOn();
  _partMode = true;
}

void Epd213::showFull(const uint8_t* frame) {
  uint32_t t0 = millis();
  initFull();
  writeRam(0x24, frame);           // new
  writeRam(0x26, frame);           // old = new: the base for partials
  cmd(0x22); data(0xC7);           // display with the loaded LUT, power off
  cmd(0x20);
  waitBusy();
  _haveBase = true;
  _partials = 0;
  _lastMs = millis() - t0;
}

void Epd213::showPartial(const uint8_t* frame) {
  if (!_haveBase) { showFull(frame); return; }
  uint32_t t0 = millis();
  if (!_partMode) initPartial();
  writeRam(0x24, frame);           // new; 0x26 still holds the old image
  cmd(0x22); data(0x04);           // display only, power stays on
  cmd(0x20);
  waitBusy();
  writeRam(0x26, frame);           // becomes the base for the next partial
  _partials++;
  _lastMs = millis() - t0;
}

void Epd213::show(const uint8_t* frame) {
  if (!_haveBase || (_fullEvery && _partials >= _fullEvery)) showFull(frame);
  else showPartial(frame);
}

void Epd213::sleep() {
  cmd(0x22); data(0xC3);           // power off
  cmd(0x20);
  waitBusy();
  cmd(0x10); data(0x01);           // deep sleep
  _partMode = false;
  delay(100);
}

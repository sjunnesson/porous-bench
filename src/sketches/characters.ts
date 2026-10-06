import { button, colors, defineSketch, hsv565, knob, sprite, type Sprite } from '../sim';

// Two-frame walking robot. One letter per colour; '.' is transparent.
const ROBOT_ROWS = {
  head: [
    '......r.....',
    '......g.....',
    '..########..',
    '.##########.',
    '.##ww##ww##.',
    '.##wp##wp##.',
    '.##########.',
    '.###mmmm###.',
    '..########..',
    '...gggggg...',
    '.g.######.g.',
    'g..######..g',
  ],
  legsA: ['...##..##...', '..gg....gg..'],
  legsB: ['....#..#....', '....gg.gg...'],
};

function makeRobot(color: boolean): Sprite {
  return sprite({
    palette: color
      ? { '#': colors.SKYBLUE, w: colors.WHITE, p: colors.BLACK, m: colors.NAVY, g: colors.SILVER, r: colors.RED }
      : // 1-bit: body lit, eye sockets and mouth dark, pupils lit.
        { '#': colors.WHITE, w: colors.BLACK, p: colors.WHITE, m: colors.BLACK, g: colors.WHITE, r: colors.WHITE },
    frames: [
      [...ROBOT_ROWS.head, ...ROBOT_ROWS.legsA],
      [...ROBOT_ROWS.head, ...ROBOT_ROWS.legsB],
    ],
  });
}

const LINES = ['Hello!', 'Beep boop.', 'Nice screen.', 'Press SPACE', 'to jump!'];

let robot: Sprite;
let scale = 1;
let x = 0;
let dir = 1;
let jumpT = -1;
let groundY = 0;
let textBottom = 0;
let step = 0;
let lineIdx = 0;
let lastLine = 0;

export default defineSketch({
  name: 'Characters',
  description: 'Fonts (built-in 5x7 at several sizes, browser fonts) and a walking pixel-art sprite. Space = jump, knob = walk speed.',
  inputs: {
    jump: button({ label: 'Jump', key: 'Space' }),
    speed: knob({ label: 'Walk speed', min: -6, max: 6, start: 2 }),
  },

  setup({ display, device }) {
    if (device.tech === 'epaper') display.setRotation(1);
    const W = display.width();
    const H = display.height();
    const color = display.isColor();
    robot = makeRobot(color);
    scale = H >= 200 ? 3 : H >= 100 ? 2 : 1;

    display.fillScreen(colors.BLACK);
    display.setTextWrap(false);
    let y = 2;
    const sizes = H >= 200 ? [1, 2, 3] : H >= 64 ? [1, 2] : [1];
    for (const s of sizes) {
      display.setTextSize(s);
      display.setTextColor(color ? hsv565(40 + s * 70, 0.7, 1) : colors.WHITE);
      display.setCursor(2, y);
      display.print(s === 1 ? 'ABC abc 0123 !?#' : s === 2 ? 'Size 2' : 'Big 3');
      y += 8 * s + 3;
    }
    display.setTextSize(1);
    if (H >= 120) {
      display.setFont('bold 18px Georgia, serif');
      display.setTextColor(color ? colors.ORANGE : colors.WHITE);
      display.drawString('Georgia 18', 2, y);
      y += display.fontHeight() + 1;
      display.setFont('14px ui-monospace, monospace');
      display.setTextColor(color ? colors.CYAN : colors.WHITE);
      display.drawString('monospace 14', 2, y);
      y += display.fontHeight() + 2;
      display.setFont(null);
    }
    textBottom = y;
    groundY = H - 3;
    display.drawFastHLine(0, groundY, W, color ? colors.DARKGREEN : colors.WHITE);
    x = W / 3;
    dir = 1;
    jumpT = -1;
    step = 0;
    lineIdx = 0;
    lastLine = -1e9;
  },

  async loop({ display, inputs, millis, delay, device }) {
    const W = display.width();
    const sw = robot.width * scale;
    const sh = robot.height * scale;
    const now = millis();

    if (inputs.jump.wasPressed() && jumpT < 0) jumpT = now;
    const speed = inputs.speed.getPosition();
    if (speed) dir = Math.sign(speed);

    // Erase the area the robot can occupy (between text and ground).
    const top = textBottom;
    display.fillRect(0, top, W, groundY - top, colors.BLACK);

    x += speed * 0.5 * scale;
    if (x < 0) x += W + sw;
    if (x > W) x -= W + sw;
    if (speed) step += Math.abs(speed) * 0.05;

    let lift = 0;
    if (jumpT >= 0) {
      const u = (now - jumpT) / 600;
      if (u >= 1) jumpT = -1;
      else lift = Math.sin(u * Math.PI) * sh * 0.9;
    }
    const ry = groundY - sh - lift;
    display.drawSprite(robot, x, ry, { frame: Math.floor(step) % 2, scale, flipX: dir < 0 });
    if (x + sw > W) display.drawSprite(robot, x - W - sw, ry, { frame: Math.floor(step) % 2, scale, flipX: dir < 0 });

    // Speech bubble
    if (now - lastLine > 2500) {
      lastLine = now;
      lineIdx = (lineIdx + 1) % LINES.length;
    }
    const msg = LINES[lineIdx];
    const bw = display.textWidth(msg) + 8;
    const bx = Math.min(W - bw - 1, Math.max(1, x + sw / 2 - bw / 2));
    const by = ry - 16;
    if (by > top) {
      display.fillRoundRect(bx, by, bw, 13, 4, colors.WHITE);
      display.setTextColor(colors.BLACK);
      display.drawString(msg, bx + 4, by + 3);
    }

    await display.show();
    await delay(device.tech === 'epaper' ? 0 : 33);
  },
});

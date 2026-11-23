<div align="center">

# KickTV Alpha for LG webOS

</div>

<p align="center"><a href="README.md">Português</a> | English</p>

KickTV Alpha is an independent app for watching Kick livestreams on LG TVs. It uses native HLS playback by default and offers fullscreen viewing or theater mode with read-only public chat. The project targets the LG OLED C3 running webOS 25.

## Install and run on the LG C3

### Windows

1. Download and install [webOS Dev Manager for Windows](https://github.com/webosbrew/dev-manager-desktop/releases/latest).
2. Enable **Developer Mode** and **Key Server** on the TV. In Dev Manager, add the TV using the IP address and passphrase shown on its screen. The PC and TV must be on the same network.
3. Get the KickTV IPK from [Releases](https://github.com/junior0xd/kicktv-for-webOS/releases) if available, or build it using the Ubuntu steps below. In Dev Manager, select the TV, install the `.ipk` file, and open KickTV on the TV.

### Ubuntu

On an Ubuntu computer on the same network as the TV, use Node.js 22, npm, Python 3, and `ar` (from the `binutils` package). From the repository root, install the dependencies and build the IPK.

```bash
npm ci
npm ci --prefix service --omit=dev --ignore-scripts --no-audit --no-fund
npm run package
```

Enable **Developer Mode** and **Key Server** on the TV. Replace `TV_IP` with the TV’s IP address and enter the passphrase shown on the TV when `--getkey` prompts you. If the CLI already has a device named `lgc3`, use `--modify` in place of `--add`.

```bash
npx ares-config --profile tv
npx ares-setup-device --add lgc3 --info '{"host":"TV_IP","port":"9922","username":"prisoner"}'
npx ares-novacom --device lgc3 --getkey

APP_ID=$(node -p "require('./app/appinfo.json').id")
APP_VERSION=$(node -p "require('./app/appinfo.json').version")
npx ares-install --device lgc3 "dist/releases/${APP_ID}_${APP_VERSION}_all.ipk"
npx ares-launch --device lgc3 "$APP_ID"
```

In the app, enter a channel name or URL and select **Assistir** (Watch). Press **OK** during playback to open the controls.

## Run the tests

After installing the dependencies from the Ubuntu section, install Playwright’s Chromium and run the test suite.

```bash
npx playwright install --with-deps chromium
npm test
```

The suite runs unit, chat, and browser tests. For on-device testing and tests for the optional backend, see the [test guide in Portuguese](docs/TESTES.md).

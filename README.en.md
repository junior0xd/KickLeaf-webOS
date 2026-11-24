<div align="center">

# KickLeaf

<img src="assets/kickleaf-icon.png" alt="KickLeaf icon" width="130">

A lightweight, unofficial Kick client for webOS.<br>
Built for the big screen.

</div>

<p align="center"><a href="README.md">Português</a> | English</p>

KickLeaf is an independent app for watching Kick livestreams on LG TVs. It uses native HLS playback by default and offers fullscreen viewing or theater mode with read-only public chat. The project targets the LG OLED C3 running webOS 25.

## Important notice

KickLeaf is an independent, unofficial, open-source project. It has no affiliation, partnership, formal authorization, or endorsement from Kick Streaming or LG Electronics.

The app uses unofficial mechanisms to discover and play public Kick livestreams and to display chat messages in read-only mode. The platform does not guarantee these integrations, and they may stop working if its services, protocols, or access mechanisms change.

The project aims to let people watch Kick livestreams directly on LG webOS TVs without relying on screen mirroring or external relay servers.

Development prioritizes responsible use of Kick’s infrastructure by seeking to minimize unnecessary requests, avoid excessive traffic, and prevent undue load on the platform’s services.

This project is available for personal, educational, and experimental use. Its operation is not guaranteed, and users are responsible for complying with the applicable terms of the services they access.

## Install and run on the LG C3

### Windows

1. Download and install [webOS Dev Manager for Windows](https://github.com/webosbrew/dev-manager-desktop/releases/latest).
2. Enable **Developer Mode** and **Key Server** on the TV. In Dev Manager, add the TV using the IP address and passphrase shown on its screen. The PC and TV must be on the same network.
3. Get the KickLeaf IPK from [Releases](https://github.com/junior0xd/KickLeaf-webOS/releases) if available, or build it using the Ubuntu steps below. In Dev Manager, select the TV, install the `.ipk` file, and open KickLeaf on the TV.

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

If you already have KickTV Alpha installed, webOS installs KickLeaf (`com.kickleaf.client`) as a separate app. KickLeaf starts with its default settings.

## Run the tests

After installing the dependencies from the Ubuntu section, install Playwright’s Chromium and run the test suite.

```bash
npx playwright install --with-deps chromium
npm test
```

The suite runs unit, chat, and browser tests. For on-device testing and tests for the optional backend, see the [test guide in Portuguese](docs/TESTES.md).

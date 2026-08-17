# Astro

A minimal, self-hosted Markdown note-taking application inspired by Obsidian.

![Astro](static/astro.png)

## Requirements

* Python 3.14+
* Git

## Installation

### Linux / macOS

```bash
git clone https://github.com/ederdiez/astro.git
cd astro

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python app.py
```

Open `http://127.0.0.1:5005`.

### Windows

Install Python and Git, then run:

```powershell
git clone https://github.com/ederdiez/astro.git
cd astro

py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

python app.py
```

Open `http://127.0.0.1:5005`.

If PowerShell blocks script execution, activate the environment with:

```cmd
.venv\Scripts\activate.bat
```

## Self-hosting

Astro can run on any computer or server with Python installed.

```bash
git clone https://github.com/ederdiez/astro.git
cd astro
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

The server listens on port `5005`.

For permanent deployments, Astro can be run as a `systemd` service on Linux or as a background service on Windows/macOS.

## Remote access with Tailscale

Tailscale allows you to access Astro privately from your other devices without exposing the application directly to the Internet. Tailscale provides clients for Linux, Windows, macOS, iOS and Android.

### Server

Install Tailscale on the machine running Astro and log in:

```bash
sudo tailscale up
```

Then find its Tailscale IP:

```bash
tailscale ip
```

### Client

Install Tailscale on your PC, Mac or phone and log in with the same account.

You can then access Astro using:

```text
http://TAILSCALE_IP:5005
```

For example:

```text
http://100.x.x.x:5005
```

### Tailscale Serve

For HTTPS and a cleaner address, you can use Tailscale Serve:

```bash
sudo tailscale serve --bg 5005
```

Tailscale will provide a private HTTPS address accessible from devices in your tailnet.

> **Security note**: Astro has **no built-in authentication**. Anyone who can reach port
> `5005` can read and edit all your notes. Only expose it on networks you trust.
> If you use Tailscale, restrict access with a Tailscale ACL so only your devices can
> reach the server, for example by tagging the server and limiting who can dial it
> (see the Tailscale admin console → ACLs). Do not forward the port to the public
> Internet.

## Data

Notes are stored as regular Markdown files inside:

```text
galaxies/
```

No database is required. Your notes can be backed up, copied or edited independently of Astro.

## Features

* Markdown editor
* Live preview
* Autosave
* Wikilinks with `[[Note]]`
* Search
* Multiple galaxies
* Import existing Markdown collections
* Graph view
* No database
* Fully self-hosted

## License

See the repository for license information.

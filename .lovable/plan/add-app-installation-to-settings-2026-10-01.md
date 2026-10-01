# Add app installation to Settings

## What will change
- Add an “Install App” section to Settings for every role that can open the page.
- Show a prominent install button when the browser supports direct installation.
- Show concise device-specific instructions when installation must be completed from the browser menu, especially on iPhone/iPad.
- Detect when the app is already installed and show that status instead of the install action.

## Technical details
- Reuse the existing install prompt event and app styling; no new offline behavior or background caching will be added.
- Keep the existing automatic install prompt unchanged.
- Add only the minimum installation metadata needed if the current setup does not expose it correctly.
- Verify the Settings screen at phone width and confirm the project remains error-free.

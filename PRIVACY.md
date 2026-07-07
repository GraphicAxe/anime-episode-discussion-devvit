# Privacy Policy for Goodbye Lara Bot

This Privacy Policy describes how the Goodbye Lara Bot ("the App") handles data on the Reddit platform.

## 1. Information We Collect
The App is built on Reddit's Developer Platform (Devvit). We do not run third-party servers, databases, or analytics engines. 
* **Subreddit Mappings:** We store basic configuration and post status metadata (Reddit post IDs, episode numbers, and permalinks) inside Reddit's secure local key-value store (Redis) to schedule posts and update links.
* **No Personal Data:** We do not collect, store, or transmit any personally identifiable information (PII) of Reddit users.

## 2. Information Sharing
We do not sell, trade, or share any data.
* **Discord Integration:** If configured by the subreddit administrators, the App sends automated operational alerts (post success, error logs, thread deletion notices) to a Discord webhook URL provided by the administrators. No user data is sent in these messages.

## 3. Data Deletion
All app data is hosted within Reddit's sandboxed environment. Uninstalling the App from your subreddit will permanently delete all associated metadata stored in the app's Redis state.

============================================================
  INSURANCE CLAIMS MIS - REALTIME FOLDER LISTENER
============================================================

This service automatically creates folders on D:\2026-27
the moment a new claim or policy is registered in the portal.

SETUP (on your Windows cloud server):
--------------------------------------

1. Make sure Node.js is installed on the server
   Download from: https://nodejs.org (LTS version)

2. Copy this entire "folder-listener" folder to your server
   e.g., C:\InsuranceMIS\folder-listener\

3. Open Command Prompt (as Administrator) and navigate to the folder:
   cd C:\InsuranceMIS\folder-listener

4. Install dependencies:
   npm install

5. Test it first (run manually):
   node listener.js

   You should see:
   - [INFO] Creating folders for existing claims and policies...
   - [LISTENING] Listening for new CLAIMS...
   - [LISTENING] Listening for new POLICIES...
   - [LISTENING] Listening for new SURVEY FEE BILLS...

6. Install as a Windows Service (auto-starts on boot):
   node install-service.js

   This registers "Insurance Folder Listener" as a Windows Service.
   It will auto-start when the server boots and restart on failures.

MANAGE THE SERVICE:
-------------------
- View status:    sc query "Insurance Folder Listener"
- Stop service:   sc stop "Insurance Folder Listener"
- Start service:  sc start "Insurance Folder Listener"
- Open Services:  services.msc (find "Insurance Folder Listener")
- Uninstall:      node install-service.js --uninstall

LOGS:
-----
- Console output when running manually
- Log file: folder-listener.log (in same directory)
- Heartbeat logged every 30 minutes

IMPORTANT - ENABLE REALTIME IN SUPABASE:
-----------------------------------------
Before running this service, you must enable Realtime on
these tables in the Supabase Dashboard:

1. Go to: https://supabase.com/dashboard
2. Select your project
3. Go to Database > Replication
4. Enable Realtime for: claims, policies, survey_fee_bills

Without this step, the listener won't receive real-time events.

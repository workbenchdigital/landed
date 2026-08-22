// Eigenstaendiges, zur Build-Zeit kompiliertes Systray-Hilfsprogramm fuer
// Landed - siehe lib/tray.mjs fuer die ausfuehrliche Begruendung, warum kein
// PowerShell-Skript (Windows-Eigenart: ein per Node spawn() direkt
// "detached" gestarteter powershell.exe/pwsh.exe-Host liess den
// WinForms-Message-Loop sofort zurueckkehren statt zu laufen, siehe
// nodejs/node#51018 - ein echtes, kompiliertes .exe hat dieses Problem
// nachweislich NICHT). Eigene .exe-Identitaet loest ausserdem ein zweites
// Problem: Windows verfolgt Tray-Icon-Sichtbarkeit (NotifyIconSettings)
// ueber den Pfad der hostenden .exe - ein generisches "powershell.exe"
// waere nicht von jedem anderen PowerShell-Tray-Skript auf demselben
// Rechner unterscheidbar gewesen. 1:1 von der Schwester-App LANDED
// Bookmarks uebernommen (dort zuerst gebaut und live nachgebessert).
//
// Aufruf: LandedTray.exe <ExePfad der Haupt-Exe> <Port>
using System;
using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Reflection;
using System.Windows.Forms;

class TrayHelper {
  [STAThread]
  static void Main(string[] args) {
    if (args.Length < 2) return;
    string exePath = args[0];
    int port = int.Parse(args[1]);
    string baseUrl = "http://127.0.0.1:" + port;

    // Icon kommt aus der eigenen .exe (per csc.exe /win32icon: beim Bauen
    // eingebettet, siehe tools/build.mjs) - dieselbe Bildmarke wie Landed.exe
    // selbst, aber eine eigene, von Windows eindeutig unterscheidbare
    // Datei-Identitaet.
    Icon icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);

    NotifyIcon notifyIcon = new NotifyIcon();
    notifyIcon.Icon = icon;
    notifyIcon.Text = "Landed";
    notifyIcon.Visible = true;

    ContextMenuStrip menu = new ContextMenuStrip();
    ToolStripMenuItem openItem = new ToolStripMenuItem("Öffnen");
    ToolStripMenuItem quitItem = new ToolStripMenuItem("Beenden");
    menu.Items.Add(openItem);
    menu.Items.Add(quitItem);
    notifyIcon.ContextMenuStrip = menu;

    EventHandler openAction = delegate {
      try { Process.Start(exePath); } catch { }
    };
    openItem.Click += openAction;
    notifyIcon.DoubleClick += openAction;

    quitItem.Click += delegate {
      // Codemouse-Review PR #68: vorher raeumte das Icon sich IMMER weg,
      // auch wenn UploadString() fehlschlug - liesse den Server bei einem
      // (seltenen, aber moeglichen) Loopback-Hicksup weiterlaufen, aber ohne
      // Tray-Bedienung mehr. Nur nach erfolgreich UEBERMITTELTER Anfrage
      // sofort raeumen; schlaegt sie fehl, bleibt das Icon stehen - der
      // Totmann-Timer (siehe unten) raeumt trotzdem auf, sobald der Server
      // tatsaechlich weg ist, und der Nutzer kann "Beenden" einfach erneut
      // klicken.
      bool shutdownRequested = false;
      try {
        using (WebClient client = new WebClient()) {
          client.Headers[HttpRequestHeader.ContentType] = "application/json";
          client.UploadString(baseUrl + "/api/shutdown", "POST", "");
          shutdownRequested = true;
        }
      } catch { }
      if (shutdownRequested) {
        notifyIcon.Visible = false;
        Application.Exit();
      }
    };

    // Totmann-Timer: stirbt der Server unerwartet (Absturz, Task-Manager)
    // oder ganz normal ueber die Web-UI/--stop, soll das Icon nicht
    // verwaist im Tray haengen bleiben - deckt jeden Beendigungsweg
    // einheitlich ab, statt jeden einzeln extra zu signalisieren. Landed
    // hat keinen eigenen /api/ping-Endpunkt (anders als LANDED Bookmarks) -
    // /api/scan-meta ist derselbe leichte Lebenszeichen-Aufruf, den
    // server.mjs' probeExistingInstance() bereits fuer die
    // Einzelinstanz-Erkennung nutzt.
    Timer timer = new Timer();
    timer.Interval = 5000;
    timer.Tick += delegate {
      try {
        // WebClient.DownloadString() hat kein explizites Timeout (Default
        // 100s) - stuenden Server-Socket nur angenommen, aber nie
        // antwortend, haette das den WinForms-UI-Thread (Timer.Tick laeuft
        // dort) fuer bis zu 100s blockiert, statt in den erwarteten ~5s zu
        // reagieren. HttpWebRequest mit explizitem Timeout/ReadWriteTimeout
        // statt WebClient (derselbe Codemouse-Fund wie bei LANDED Bookmarks).
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/scan-meta");
        request.Timeout = 2000;
        request.ReadWriteTimeout = 2000;
        using (HttpWebResponse response = (HttpWebResponse)request.GetResponse()) {
          if (response.StatusCode != HttpStatusCode.OK) throw new WebException("Kein 200 bei /api/scan-meta");
        }
      } catch {
        notifyIcon.Visible = false;
        Application.Exit();
      }
    };
    timer.Start();

    Application.Run();
  }
}

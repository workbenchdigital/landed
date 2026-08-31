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
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Forms;

class TrayHelper {
  // Faelligkeits-Punkt direkt auf dem Icon. Im Test (31.08.2026) liess sich
  // die Ballon-Meldung unten NICHT nachweisen: Windows unterdrueckt Toasts
  // je nach Zustand (Vollbild-App, Fokus-Assistent), und eine unsignierte
  // Helfer-Exe ohne AppUserModelID hat ohnehin keine verlaessliche
  // Toast-Registrierung. Der Tooltip wiederum verlangt, dass man mit der
  // Maus hinfaehrt - beides zusammen loest "erreicht mich, ohne dass ich die
  // App oeffne" nur halb. Ein Punkt am Icon haengt an gar keiner
  // Windows-Berechtigung und ist im Augenwinkel sichtbar.
  //
  // Weisser Ring um den roten Punkt, damit er auf hellen wie dunklen
  // Taskleisten Kontrast hat.
  static Icon WithDueDot(Icon baseIcon) {
    using (Bitmap source = baseIcon.ToBitmap()) {
      Bitmap canvas = new Bitmap(source);
      using (Graphics g = Graphics.FromImage(canvas)) {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        int size = Math.Max(7, canvas.Width * 7 / 16);
        int x = canvas.Width - size;
        int y = canvas.Height - size;
        using (Pen ring = new Pen(Color.White, Math.Max(1f, canvas.Width / 24f))) {
          g.FillEllipse(Brushes.OrangeRed, x, y, size - 1, size - 1);
          g.DrawEllipse(ring, x, y, size - 1, size - 1);
        }
      }
      // GetHicon() erzeugt ein GDI-Handle, das ohne DestroyIcon lecken
      // wuerde. Beide Varianten entstehen deshalb EINMAL beim Start und
      // werden danach nur noch umgeschaltet - im 5s-Takt neu zu erzeugen
      // waere ein echtes Handle-Leck.
      return Icon.FromHandle(canvas.GetHicon());
    }
  }

  // Bewusst Regex statt eines JSON-Deserialisierers: es geht um genau zwei
  // Ganzzahlen aus einer Antwort, die dieses Projekt selbst erzeugt
  // (server.mjs scanMetaHandler). Ein JavaScriptSerializer haette eine
  // zusaetzliche Assembly-Referenz im csc-Aufruf und Cast-Ketten gekostet,
  // ohne hier irgendetwas robuster zu machen.
  // ponytail: enge Feldsuche, kein JSON-Parser - bricht die Antwort je aus
  // diesem Schema aus, liefert das -1 und der Tooltip bleibt schlicht beim
  // Grundtext stehen.
  static int ReadIntField(string json, string field) {
    Match m = Regex.Match(json, "\"" + field + "\"\\s*:\\s*(\\d+)");
    return m.Success ? int.Parse(m.Groups[1].Value) : -1;
  }

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
    Icon iconDue = WithDueDot(icon);

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
    // Eine Faelligkeitsmeldung, die man anklickt, soll auch dorthin fuehren -
    // sonst muesste der Nutzer nach dem Lesen erst das Icon suchen.
    notifyIcon.BalloonTipClicked += openAction;

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
    // Runde-5-Befund #1 (Messung 31.08.2026): 11 von 12 gesetzten
    // Wiedervorlagen waren ueberfaellig, die aeltesten seit vier Tagen. Es
    // gab keinen Kanal, der den Nutzer erreicht, ohne dass er die App
    // oeffnet - genau das aendert dieses Icon. Bei einem ANSTIEG der
    // faelligen Zahl einmal eine Ballon-Meldung, sonst nur der stille
    // Tooltip: nicht bei jedem 5s-Takt erneut melden, aber die eine
    // Zustandsaenderung, die den Nutzer wirklich betrifft, auch nicht
    // verschlucken. Startwert -1 statt 0, damit direkt der erste Durchlauf
    // nach dem Serverstart meldet, wenn schon etwas faellig ist.
    int lastDue = -1;
    Timer timer = new Timer();
    timer.Interval = 5000;
    timer.Tick += delegate {
      string body;
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
          using (StreamReader reader = new StreamReader(response.GetResponseStream())) {
            body = reader.ReadToEnd();
          }
        }
      } catch {
        notifyIcon.Visible = false;
        Application.Exit();
        return;
      }

      // AB HIER lebt der Server nachweislich. Ein Fehler beim Auswerten der
      // Antwort darf das Icon deshalb NICHT mehr beenden - sonst haette ein
      // unerwartetes Antwortformat denselben Effekt wie ein Serverabsturz
      // und das Icon waere weg, obwohl Landed einwandfrei laeuft. Der
      // Totmann-Schalter oben bleibt allein fuer echte Verbindungsfehler
      // zustaendig.
      try {
        int open = ReadIntField(body, "openCount");
        int due = ReadIntField(body, "dueSnoozeCount");
        // Verlaesslichster der drei Kanaele: haengt an keiner
        // Benachrichtigungs-Berechtigung und braucht kein Hovern.
        if (due >= 0) notifyIcon.Icon = due > 0 ? iconDue : icon;
        if (open >= 0) {
          string text = "Landed: " + open + " offen";
          if (due > 0) text += ", " + due + " fällig";
          // NotifyIcon.Text wirft oberhalb von 63 Zeichen - bei realistischen
          // Bestaenden unerreichbar, aber ein harter Wurf im 5s-Takt waere ein
          // teurer Preis fuer eine ungeprueft uebernommene Laengenannahme.
          notifyIcon.Text = text.Length > 63 ? text.Substring(0, 63) : text;
        }
        if (due > 0 && due > lastDue) {
          notifyIcon.BalloonTipTitle = "Landed";
          notifyIcon.BalloonTipText = due == 1
            ? "1 Wiedervorlage ist fällig."
            : due + " Wiedervorlagen sind fällig.";
          notifyIcon.ShowBalloonTip(10000);
        }
        if (due >= 0) lastDue = due;
      } catch { }
    };
    timer.Start();

    Application.Run();
  }
}

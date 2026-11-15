#!/usr/bin/env python3
"""
Build the user guide:

    python tools/make_guide.py

Writes "Aux Tracker Guide.docx" in the project folder, then uses LibreOffice
(if installed) to make the .doc and .pdf copies. Screenshots come from
tools/screens/ (made with tools/shot.html and headless Edge). Needs python-docx.
"""
import os
import subprocess
from datetime import date

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

VERSION = "1.0.1"
ADDRESS = "https://jlblan2.github.io/aux-tracker/"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
SCREENS = os.path.join(HERE, "screens")
OUT = os.path.join(ROOT, "Aux Tracker Guide.docx")
SOFFICE = r"C:\Program Files\LibreOffice\program\soffice.exe"

NAVY = RGBColor(0x0A, 0x2A, 0x4A)
TEAL = RGBColor(0x0E, 0x7C, 0x72)
GREY = RGBColor(0x55, 0x5F, 0x6B)
FONT = "Arial"

doc = Document()

# ── page and styles ──────────────────────────────────────────────────────────
sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.5), Inches(11)
sec.left_margin = sec.right_margin = Inches(1)
sec.top_margin = sec.bottom_margin = Inches(0.9)


def style(name, size, bold=False, color=None, before=0, after=6, keep=False):
    s = doc.styles[name]
    s.font.name = FONT
    s.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    s.font.size = Pt(size)
    s.font.bold = bold
    s.font.italic = False
    if color is not None:
        s.font.color.rgb = color
    pf = s.paragraph_format
    pf.space_before, pf.space_after = Pt(before), Pt(after)
    pf.keep_with_next = keep
    return s


style("Normal", 11, after=6).paragraph_format.line_spacing = 1.12
style("Title", 28, bold=True, color=NAVY, after=4)
style("Subtitle", 14, color=TEAL, after=18)
style("Heading 1", 18, bold=True, color=NAVY, before=18, after=8, keep=True)
style("Heading 2", 14, bold=True, color=TEAL, before=14, after=6, keep=True)
style("Heading 3", 12, bold=True, color=NAVY, before=10, after=4, keep=True)
style("List Bullet", 11, after=3)
style("Caption", 9, color=GREY, after=10)


def para(text="", bold_lead=None, style_name=None, align=None, after=None, italic=False, color=None):
    """A paragraph. bold_lead is put in bold in front of the text."""
    p = doc.add_paragraph(style=style_name)
    if bold_lead:
        p.add_run(bold_lead).bold = True
    r = p.add_run(text)
    r.italic = italic
    if color is not None:
        r.font.color.rgb = color
    if align is not None:
        p.alignment = align
    if after is not None:
        p.paragraph_format.space_after = Pt(after)
    return p


def h1(text):
    return doc.add_heading(text, level=1)


def h2(text):
    return doc.add_heading(text, level=2)


def h3(text):
    return doc.add_heading(text, level=3)


def bullets(items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        if isinstance(item, tuple):
            p.add_run(item[0]).bold = True
            p.add_run(item[1])
        else:
            p.add_run(item)


def steps(items):
    """Numbered steps, typed out so every list starts again at 1."""
    for i, item in enumerate(items, 1):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.left_indent, pf.first_line_indent = Inches(0.35), Inches(-0.3)
        pf.space_after = Pt(4)
        p.add_run(f"{i}.").bold = True
        p.add_run("\t")
        pf.tab_stops.add_tab_stop(Inches(0.35))
        if isinstance(item, tuple):
            p.add_run(item[0]).bold = True
            p.add_run(item[1])
        else:
            p.add_run(item)


def shade(cell, hex_fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)


def cell_margins(table, top=70, bottom=70, left=110, right=110):
    tbl_pr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for side, val in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tbl_pr.append(mar)


def note(text, lead="Note: ", fill="FFF4D6"):
    """A shaded one-cell box for warnings and tips."""
    t = doc.add_table(rows=1, cols=1)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.style = "Table Grid"
    cell_margins(t, 90, 90, 140, 140)
    c = t.rows[0].cells[0]
    c.width = Inches(6.5)
    shade(c, fill)
    p = c.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.add_run(lead).bold = True
    p.add_run(text)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def table(headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    cell_margins(t)
    for i, text in enumerate(headers):
        c = t.rows[0].cells[i]
        c.width = Inches(widths[i])
        shade(c, "0A2A4A")
        p = c.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(text)
        r.bold = True
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    for n, row in enumerate(rows):
        new_row = t.add_row()
        cant = OxmlElement("w:cantSplit")          # never break a row across two pages
        cant.set(qn("w:val"), "true")
        new_row._tr.get_or_add_trPr().append(cant)
        cells = new_row.cells
        for i, text in enumerate(row):
            cells[i].width = Inches(widths[i])
            if n % 2:
                shade(cells[i], "F1F5F9")
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            r = p.add_run(text)
            if i == 0:
                r.bold = True
    # repeat the header row on each page
    tr_pr = t.rows[0]._tr.get_or_add_trPr()
    hdr = OxmlElement("w:tblHeader")
    hdr.set(qn("w:val"), "true")
    tr_pr.append(hdr)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def screens(items, width=2.25):
    """Screenshots side by side with captions underneath. items = [(file, caption), ...]"""
    t = doc.add_table(rows=2, cols=len(items))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (name, caption) in enumerate(items):
        c = t.rows[0].cells[i]
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.keep_with_next = True
        p.add_run().add_picture(os.path.join(SCREENS, name + ".jpg"), width=Inches(width))
        cp = t.rows[1].cells[i].paragraphs[0]
        cp.style = doc.styles["Caption"]
        cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cp.add_run(caption)
    for row in t.rows:                      # keep picture and caption on one page
        tr_pr = row._tr.get_or_add_trPr()
        cant = OxmlElement("w:cantSplit")
        cant.set(qn("w:val"), "true")
        tr_pr.append(cant)


def page_break():
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def add_field(paragraph, instr):
    run = paragraph.add_run()
    for kind, text in (("begin", None), (None, instr), ("end", None)):
        if kind:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
        else:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = text
        run._r.append(el)
    return run


# footer: title on the left, page number on the right
fp = sec.footer.paragraphs[0]
fp.paragraph_format.tab_stops.add_tab_stop(Inches(6.5), alignment=2)
r = fp.add_run(f"Aux Tracker {VERSION} \u2013 User Guide\tPage ")
r.font.size = Pt(9)
r.font.color.rgb = GREY
add_field(fp, "PAGE").font.size = Pt(9)

# ── title page ───────────────────────────────────────────────────────────────
for _ in range(3):
    doc.add_paragraph()
doc.add_paragraph("Aux Tracker", style="Title")
doc.add_paragraph("User Guide for iPhone and Android", style="Subtitle")
para(f"App version {VERSION}   •   Guide dated {date.today().strftime('%B %d, %Y').replace(' 0', ' ')}", color=GREY)
para("")
para("Aux Tracker turns a phone and a Meshtastic radio into a position tracker. When the radio’s default "
     "channel is named “aux”, the app broadcasts the phone’s GPS position on that channel about every "
     "10 seconds, so every other radio on the aux channel can follow where you are. It also sends and receives "
     "messages and shows the other stations in a list and on a map.")
para("Aux Tracker cannot change any setting on the radio. The radio must already be set up; the app only uses it.")
para("The app address is:")
para(ADDRESS, align=WD_ALIGN_PARAGRAPH.CENTER).runs[0].bold = True
para("")
h3("In this guide")
for line in [
    "1.  Before you start",
    "2.  Installing on an Android phone",
    "3.  Installing on an iPhone or iPad",
    "4.  Connecting to your radio",
    "5.  The Tracker screen",
    "6.  Keeping the tracker running",
    "7.  Messages, Nodes, Map and Info",
    "8.  What the radio does with your position",
    "9.  The demo radio",
    "10. Updating the app",
    "11. Troubleshooting",
    "12. What is kept on the phone",
    "13. How Aux Tracker differs from Meshtastic Mobile",
]:
    para(line, after=1).paragraph_format.left_indent = Inches(0.25)
para("")
para("Meshtastic® is a registered trademark of Meshtastic LLC. This app is independent and is not affiliated "
     "with or endorsed by the Meshtastic project.", italic=True, color=GREY)
page_break()

# ── 1 ────────────────────────────────────────────────────────────────────────
h1("1.  Before you start")
para("Aux Tracker is a web app. There is nothing to buy and nothing to download from an app store for the app "
     "itself: you open its address in a suitable browser, and allow the page to use Bluetooth and your location.")
h3("What you need")
bullets([
    ("A Meshtastic radio whose default channel is named “aux”. ", "The default channel is the radio’s "
     "primary channel, slot 0. Capital letters do not matter (aux, Aux and AUX all count). A secondary channel "
     "named aux does not count. If the default channel has any other name, the app connects but does not send "
     "your position."),
    ("A radio that is already set up. ", "Region, channels, keys and names must be set beforehand with the "
     "Meshtastic app, Meshtastic Mobile, or the PC program. Aux Tracker cannot change them."),
    ("The radio’s Bluetooth pairing PIN. ", "On a radio with a screen, the 6-digit PIN appears on the screen "
     "when the phone asks for it. On a radio without a screen the PIN is 123456 unless it has been changed."),
    ("Location turned on in the phone, ", "and a view of the sky for GPS."),
    ("An internet connection ", "the first time you open the app, and whenever you use the Map. Tracking and "
     "messages work without internet once the app is open."),
    ("The right browser for your phone: ", "see the table below."),
])
table(["Phone", "Browser to use", "Why"], [
    ["Android", "Google Chrome (Microsoft Edge also works)",
     "Chrome on Android can use Bluetooth radios directly. Firefox and Samsung Internet cannot."],
    ["iPhone / iPad", "Bluefy – Web BLE Browser (free, from the App Store)",
     "Apple does not allow Safari, or Chrome on iPhone, to use Bluetooth radios from a web page. Bluefy is a "
     "browser made for this purpose."],
], [1.2, 2.3, 3.0])
note("Only one program can use a radio’s Bluetooth link at a time. Before connecting, close the official "
     "Meshtastic app and Meshtastic Mobile, and disconnect the PC program if it is connected to the same radio "
     "by Bluetooth.", lead="Important: ")

# ── 2 ────────────────────────────────────────────────────────────────────────
h1("2.  Installing on an Android phone")
steps([
    "Make sure Bluetooth and Location are turned on in the phone’s settings.",
    ("Open Chrome ", "and go to  " + ADDRESS),
    ("Read the disclaimer ", "that appears the first time, and tap “I understand and accept”."),
    ("Add it to the Home screen: ", "tap the three-dot menu at the top right of Chrome, then “Add to Home "
     "screen” (on some phones it is called “Install app”), and confirm. An Aux Tracker icon appears on the "
     "Home screen and the app then opens full-screen like any other app."),
    ("Allow Bluetooth when asked. ", "The first time you press Connect by Bluetooth, Android may ask to let "
     "Chrome find “Nearby devices”. Choose Allow."),
    ("Allow location when asked. ", "When the tracker starts, Chrome asks whether the page may know your "
     "location. Choose Allow (“While using the app” is enough). Without it, nothing can be sent."),
])

# ── 3 ────────────────────────────────────────────────────────────────────────
h1("3.  Installing on an iPhone or iPad")
steps([
    "Make sure Bluetooth is turned on in Settings › Bluetooth, and Location Services in Settings › "
    "Privacy & Security › Location Services.",
    ("Install Bluefy: ", "open the App Store, search for “Bluefy”, and install “Bluefy – Web BLE "
     "Browser”. It is free."),
    ("Open Bluefy ", "and, if iOS asks whether Bluefy may use Bluetooth, tap Allow."),
    ("Type the app address ", "into Bluefy’s address bar:  " + ADDRESS),
    ("Read the disclaimer ", "that appears the first time, and tap “I understand and accept”."),
    ("Allow location when asked. ", "When the tracker starts, the iPhone asks whether Bluefy and the page may "
     "use your location. Choose Allow. Without it, nothing can be sent."),
    ("Save the page as a bookmark ", "in Bluefy so you can return to it without retyping the address."),
])
note("Do not use Safari’s “Add to Home Screen” for this app. An icon made that way opens the page in "
     "Safari, which cannot use Bluetooth radios, so the Connect button would not work. Always open the app from "
     "inside Bluefy.", lead="iPhone note: ")
note("At the time this guide was written, Aux Tracker had not yet been tried on an iPhone. If the Tracker card "
     "reports that location permission was refused even though you allowed it, Bluefy may not pass the phone’s "
     "location to web pages; please report it.", lead="Not yet confirmed: ", fill="E8F1FB")

# ── 4 ────────────────────────────────────────────────────────────────────────
h1("4.  Connecting to your radio")
steps([
    "Turn the radio on and keep it close to the phone.",
    "Close the official Meshtastic app and Meshtastic Mobile if they are running.",
    ("Tap Connect by Bluetooth ", "on the Tracker screen. The phone shows a list of Meshtastic radios it can see."),
    ("Choose your radio ", "from the list and confirm (Pair or Connect)."),
    ("Enter the pairing PIN ", "if the phone asks for it: the 6-digit number on the radio’s screen, or 123456 "
     "on a radio without a screen. The app shows “Waiting for pairing…” and keeps trying for about a minute "
     "and a half while you do this. The PIN is only needed the first time."),
    ("Wait while the app reads the radio. ", "It shows “Reading the radio’s nodes and settings…”. A radio "
     "with a long node list can take a minute over Bluetooth; be patient."),
    ("Allow location ", "if the phone asks."),
])
para("When the connection is complete the Tracker card appears at the top of the screen. If the radio’s default "
     "channel is aux, tracking starts by itself; you do not need to press anything else.")
para("You tap Connect by Bluetooth and pick the radio each time you open the app: a web page is not allowed to "
     "connect to a Bluetooth device on its own.")
screens([("connect", "Before connecting"), ("tracker", "Connected and tracking")])

# ── 5 ────────────────────────────────────────────────────────────────────────
h1("5.  The Tracker screen")
para("The Tracker card is outlined in green while positions are going out, and in orange when they are not. The "
     "line in large type at the top of the card says what the tracker is doing:")
table(["The card says", "What it means"], [
    ["Broadcasting location on aux every 10 seconds.", "Working. Positions are going out."],
    ["GPS ready. Sending the first position…", "The phone has a fix and the first position is about to go."],
    ["Waiting for the phone’s GPS…", "Connected, but the phone has not produced a location yet. Give it a moment "
     "with a view of the sky."],
    ["Still waiting for a GPS fix…", "No location after 30 seconds. Move somewhere with a clearer view of the sky."],
    ["Location permission was refused…", "The browser is not allowed to read your location. Allow location for "
     "the page in the browser’s settings, then disconnect and connect again."],
    ["Not sending: this radio’s default channel is “…”, not “aux”.", "The radio’s primary channel has a "
     "different name, so the app will not send. See section 11."],
    ["Paused. Location is not being sent.", "You pressed Pause. Tap “Resume sending location” to continue."],
    ["Could not send: …", "The app could not hand the position to the radio. Check the connection."],
], [2.9, 3.6])
h3("The lines on the card")
bullets([
    ("Default channel: ", "the name of the radio’s primary channel, with a tick when it is aux."),
    ("Phone GPS: ", "the latitude and longitude the phone is reporting now."),
    ("Accuracy: ", "the phone’s own estimate of how good the fix is, in metres, and how old the fix is."),
    ("Speed / course: ", "from the last position sent, in km/h and degrees. A dash means the phone gave no "
     "speed, which is normal when standing still."),
    ("Last sent: ", "the time the last position was handed to the radio."),
    ("Positions sent: ", "how many have gone out since you connected. It should rise by one about every 10 to "
     "11 seconds."),
    ("Sent to: ", "everyone on the aux channel, and how many times other radios may relay it (the radio’s hop limit)."),
])
h3("Pause and Resume")
para("“Pause sending location” stops the broadcasts without disconnecting, for example while ashore. Messages, "
     "nodes and the map keep working. “Resume sending location” starts them again.")
h3("Red notes on the card")
para("A note in red means a setting on the radio is affecting what other stations will see. The app cannot change "
     "these settings; use the Meshtastic app, Meshtastic Mobile or the PC program.")
table(["Note", "What to do about it"], [
    ["Position sharing is turned off on the aux channel (position precision 0)…",
     "The radio removes the location from every position before transmitting, so nobody sees where you are. Set "
     "the aux channel’s position precision to 32 for exact positions."],
    ["The aux channel’s position precision is N bits…",
     "The radio rounds each position before transmitting. 32 sends the exact position; lower numbers blur it."],
    ["This radio is set to a fixed position…",
     "The radio also broadcasts its fixed position, so others will see it jump between the two. Turn fixed "
     "position off on a radio used for tracking."],
    ["The radio’s own GPS is on…",
     "The radio broadcasts its own positions as well as the phone’s. This is harmless if the radio and phone "
     "are together."],
], [2.9, 3.6])
screens([("notaux", "Default channel is not aux"), ("paused", "Paused")])

# ── 6 ────────────────────────────────────────────────────────────────────────
h1("6.  Keeping the tracker running")
note("Tracking only runs while Aux Tracker is open and in front, with the screen on. A phone stops a web "
     "page’s GPS and Bluetooth when the screen locks or when you switch to another app.", lead="Important: ")
bullets([
    "The app asks the phone to keep the screen on while it is tracking. Most phones honour this; if yours still "
    "dims and locks, lengthen the screen timeout in the phone’s display settings.",
    "Do not switch to another app, answer a call in full screen, or lock the phone while you need to be tracked.",
    "If tracking was interrupted, bring the app back to the front. If the top right shows “Not connected”, "
    "tap Connect by Bluetooth again.",
    "Keeping the screen on and the GPS running uses a lot of battery. Plug the phone into power for a long patrol.",
    "Keep the phone within a few yards of the radio.",
])
para("A good habit is to glance at “Positions sent” now and then: if the number is climbing, you are being tracked.")

# ── 7 ────────────────────────────────────────────────────────────────────────
h1("7.  Messages, Nodes, Map and Info")
para("The buttons along the bottom of the screen switch between Tracker, Messages, Nodes, Map and Info. Tracking "
     "continues while you use the other screens.")
h2("Messages")
para("The ovals at the top list your conversations: one for each channel on the radio (marked with #), and one for "
     "each person you have exchanged direct messages with. Tap an oval to open it. A red number shows unread "
     "messages.")
steps([
    "Tap the conversation you want (“# aux” reaches everyone on the aux channel).",
    "Type in the box at the bottom. A message can be up to 200 bytes (about 200 plain characters).",
    "Tap Send.",
])
para("To start a direct message with one station, go to Nodes, tap the station, and tap “Send a direct message”.")
table(["Status under your message", "Meaning"], [
    ["Sending…", "The radio has the message and is transmitting it."],
    ["Sent", "A channel message went out and was heard by the mesh."],
    ["Delivered", "A direct message was confirmed by the recipient’s radio."],
    ["Sent, not yet confirmed by the recipient", "Another radio relayed your direct message, but the recipient "
     "has not confirmed it yet."],
    ["No acknowledgement", "Nothing was heard back within a minute and a half."],
    ["Failed: (reason)", "The radio could not deliver it; for example NO_ROUTE or MAX_RETRANSMIT."],
], [2.6, 3.9])
para("Messages only arrive while the app is open and connected.")
h2("Nodes")
para("Lists every station the radio knows about. Your radio is first, outlined in green. Each row shows the name, "
     "role and hardware, and on the right when the station was last heard, its distance in miles from your "
     "radio, and its signal strength or number of hops. Use Search to find a station and the box beside it to "
     "sort. Tap a station for its details, to send it a direct message, or to show it on the map.")
h2("Map")
para("Shows every station that has reported a position. Your radio is the orange dot and moves as your positions "
     "go out; the others are teal. Tap a dot for that station’s details. The map background needs an internet "
     "connection.")
h2("Info")
para("Shows, for reference only, the radio settings that affect tracking (default channel, other channels, the "
     "aux channel’s position precision, hop limit, the radio’s own position broadcast interval, fixed position, "
     "and GPS mode), a log of what the app and radio have done, and the app version. Nothing on this screen can "
     "be changed. “Open the user guide (PDF)” under About opens this guide on the phone.")
screens([("messages", "Messages"), ("nodes", "Nodes"), ("map", "Map")], width=2.0)

# ── 8 ────────────────────────────────────────────────────────────────────────
h1("8.  What the radio does with your position")
para("Each position the app sends contains the latitude and longitude, altitude, the time, the phone’s speed and "
     "course when it has them, and an estimate of GPS quality. These are the same details, in the same form, that "
     "the official Meshtastic iPhone app sends when it shares the phone’s location. Aux Tracker addresses them "
     "to everyone on the aux channel.")
bullets([
    ("About every 10 to 11 seconds. ", "The radio refuses a position from a phone that arrives less than 10 "
     "seconds after the last one, so the app leaves half a second of margin. This limit is built into the "
     "radio and cannot be shortened."),
    ("Rounded to the channel’s precision. ", "The radio rounds each position to the aux channel’s position "
     "precision before transmitting it (section 5)."),
    ("Relayed by other radios. ", "Other radios pass it on up to the radio’s hop limit, usually 3."),
    ("The radio follows the phone. ", "The radio takes the position and the time for itself as well, so its own "
     "screen and its own reports match the phone."),
    ("It is a lot of radio traffic. ", "A position every 10 seconds suits a private aux channel shared by a "
     "handful of radios. On a busy public mesh it would crowd out other stations. Use Pause when you do not "
     "need to be tracked."),
])

# ── 9 ────────────────────────────────────────────────────────────────────────
h1("9.  The demo radio")
para("“Try the demo radio” on the Tracker screen connects the app to a pretend radio built into the app, with "
     "made-up stations and a default channel named aux. The tracker runs using the phone’s real GPS, but nothing "
     "is transmitted and no real radio is touched. Use it to learn the app. The oval at the top right reads "
     "“(demo)” while it is in use. Tap Disconnect, lower on the Tracker screen, to leave it.")

# ── 10 ───────────────────────────────────────────────────────────────────────
h1("10.  Updating the app")
bullets([
    ("Android: ", "open the app while the phone has internet. It fetches the new version in the background; "
     "close the app completely and open it again to start using it."),
    ("iPhone (Bluefy): ", "reload the page while the phone has internet."),
])
para("The version you are running is shown on the Info screen under About.")

# ── 11 ───────────────────────────────────────────────────────────────────────
h1("11.  Troubleshooting")
table(["What you see", "What to do"], [
    ["“Not sending: this radio’s default channel is “…”, not “aux””",
     "The radio’s primary channel (slot 0) must be named aux. Rename or reorder the channels with the Meshtastic "
     "app, Meshtastic Mobile or the PC program, then connect again. Every radio that should see you needs the "
     "same aux channel name and key."],
    ["“Location permission was refused”",
     "Allow location for the page: in Chrome, tap the icon at the left of the address bar › Permissions › "
     "Location. On iPhone, check Settings › Privacy & Security › Location Services for Bluefy. Then disconnect "
     "and connect again."],
    ["“Waiting for the phone’s GPS…” does not clear",
     "Check that Location is switched on in the phone, and move to where the phone can see the sky."],
    ["“Positions sent” has stopped rising",
     "Make sure the app is in front and the screen is on. Check the top right still shows the radio’s name; if "
     "it says Not connected, connect again."],
    ["Other radios do not show your position",
     "Check for a red note on the Tracker card (position precision 0 removes the location). Check the other "
     "radio is on the same aux channel with the same key, and in range."],
    ["Others see the position jump back and forth",
     "The radio is also broadcasting a fixed position or its own GPS position. Turn fixed position off on the "
     "tracking radio."],
    ["“This browser can’t use Bluetooth radios”, or the Connect button is grey",
     "Wrong browser. On Android use Chrome. On iPhone open the same address in Bluefy."],
    ["No radios appear in the list",
     "Check the radio is on and close by, the phone’s Bluetooth is on, and the official Meshtastic app is closed."],
    ["The PIN prompt appears and vanishes, or the PIN is refused",
     "Open the phone’s Bluetooth settings, find the radio, and choose Forget This Device (iPhone) or Forget / "
     "Unpair (Android). Then connect again and enter the PIN shown on the radio."],
    ["“Could not finish connecting…”",
     "Another phone or program probably holds the radio. Close the Meshtastic app and Meshtastic Mobile and "
     "disconnect the PC program, then try again."],
    ["“This radio has no LoRa region set”",
     "The radio is new or was reset and cannot transmit. Set it up with the Meshtastic app, Meshtastic Mobile "
     "or the PC program first."],
    ["The map is blank", "The map background needs internet."],
], [2.6, 3.9])
para("If you need help, the Log on the Info screen lists what the app and radio did; the last few lines are the "
     "most useful thing to pass on.")

# ── 12 ───────────────────────────────────────────────────────────────────────
h1("12.  What is kept on the phone")
para("The app sends nothing to any server. Your position goes only to your radio, and from there over the air to "
     "the aux channel. Stored in the browser on your phone are:")
bullets([
    "That you accepted the disclaimer.",
    "Your recent messages for each radio (the newest 400).",
])
para("Positions are not stored. Clearing the browser’s data for the app address erases the messages.")

# ── 13 ───────────────────────────────────────────────────────────────────────
h1("13.  How Aux Tracker differs from Meshtastic Mobile")
table(["Feature", "Meshtastic Mobile", "Aux Tracker"], [
    ["Sends the phone’s position", "No", "Yes, about every 10 seconds, when the default channel is aux"],
    ["Messages, nodes, map", "Yes", "Yes"],
    ["Change radio settings", "Yes", "No. Settings are shown for reference only."],
    ["Settings backup and restore", "Yes", "No"],
    ["Restart the radio", "Yes", "No"],
    ["Needs location permission", "No", "Yes"],
], [2.4, 1.7, 2.4])
para("Use Meshtastic Mobile or the PC program to set a radio up, and Aux Tracker to track with it.")

doc.core_properties.title = "Aux Tracker – User Guide"
doc.core_properties.author = ""
doc.save(OUT)
print("wrote", OUT)

if os.path.exists(SOFFICE):
    for fmt in ("doc:MS Word 97", "pdf"):
        subprocess.run([SOFFICE, "--headless", "--convert-to", fmt, "--outdir", ROOT, OUT],
                       check=True, capture_output=True, timeout=180)
        print("wrote", os.path.splitext(OUT)[0] + "." + fmt.split(":")[0])

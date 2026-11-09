import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @Environment(HuddleStore.self) private var store
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var sleeperUsername = ""
    @State private var editingLeague: ESPNDraft?
    @State private var yahooBusy = false

    var body: some View {
        NavigationStack {
            Form {
                if let error = store.lastError {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                }

                Section {
                    TextField("Sleeper username", text: $sleeperUsername)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit(saveSleeper)
                    Button("Save", action: saveSleeper)
                        .disabled(sleeperUsername.trimmingCharacters(in: .whitespaces) == (store.accounts?.sleeper?.username ?? ""))
                } header: {
                    Text("Sleeper")
                } footer: {
                    Text("Huddle finds every league you're in for this season. Leave blank to turn Sleeper off.")
                }

                Section {
                    ForEach(store.accounts?.espn ?? []) { league in
                        Button { editingLeague = ESPNDraft(league) } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text("League \(league.leagueId)").foregroundStyle(.primary)
                                    Text(league.teamId.map { "Team \($0)" } ?? "Team found from your login")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if league.hasCookies { Image(systemName: "lock.fill").foregroundStyle(.secondary) }
                            }
                        }
                    }
                    .onDelete(perform: deleteLeagues)
                    Button("Add ESPN league") { editingLeague = ESPNDraft() }
                } header: {
                    Text("ESPN")
                } footer: {
                    Text("Open your team on fantasy.espn.com: the URL has leagueId= and teamId=. Private leagues also need two cookies from that browser.")
                }

                Section {
                    if store.accounts?.yahoo.connected == true {
                        Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                        Button("Disconnect Yahoo", role: .destructive) { Task { await store.disconnectYahoo() } }
                    } else {
                        Button {
                            Task { await connectYahoo() }
                        } label: {
                            if yahooBusy { ProgressView() } else { Text("Sign in with Yahoo") }
                        }
                        .disabled(yahooBusy || store.accounts?.yahooAvailable == false)
                    }
                } header: {
                    Text("Yahoo")
                } footer: {
                    if store.accounts?.yahooAvailable == false {
                        Text("Yahoo isn't set up on the server yet. Add the Yahoo app keys to the server (see the README).")
                    } else {
                        Text("Yahoo signs you in on its own page. Huddle only gets read access to your fantasy teams.")
                    }
                }
            }
            .navigationTitle("Accounts")
            .refreshable { await store.refreshAccounts() }
            .onChange(of: store.accounts?.sleeper?.username, initial: true) { _, name in sleeperUsername = name ?? "" }
            .sheet(item: $editingLeague) { draft in
                ESPNLeagueForm(draft: draft) { saved in
                    Task {
                        if await saveLeague(saved) { editingLeague = nil }
                    }
                }
            }
        }
    }

    private func saveSleeper() {
        Task { _ = await store.setSleeper(sleeperUsername) }
    }

    private func currentLeagues() -> [HuddleAPI.ESPNLeagueInput] {
        (store.accounts?.espn ?? []).map { .init(leagueId: $0.leagueId, teamId: $0.teamId) }
    }

    private func deleteLeagues(at offsets: IndexSet) {
        var leagues = currentLeagues()
        leagues.remove(atOffsets: offsets)
        Task { _ = await store.setESPN(leagues) }
    }

    private func saveLeague(_ draft: ESPNDraft) async -> Bool {
        var leagues = currentLeagues().filter { $0.leagueId != draft.originalID && $0.leagueId != draft.leagueId }
        var input = HuddleAPI.ESPNLeagueInput(leagueId: draft.leagueId.trimmingCharacters(in: .whitespaces), teamId: Int(draft.teamId.trimmingCharacters(in: .whitespaces)))
        if draft.isPrivate && !(draft.espnS2.isEmpty && draft.swid.isEmpty) {
            input.espnS2 = draft.espnS2.trimmingCharacters(in: .whitespacesAndNewlines)
            input.swid = draft.swid.trimmingCharacters(in: .whitespacesAndNewlines)
        } else if !draft.isPrivate {
            input.espnS2 = ""
            input.swid = ""
        }
        leagues.append(input)
        return await store.setESPN(leagues)
    }

    private func connectYahoo() async {
        yahooBusy = true
        defer { yahooBusy = false }
        guard let start = await store.yahooSignInURL() else { return }
        do {
            let callback = try await webAuthenticationSession.authenticate(using: start.url, callbackURLScheme: start.callbackScheme)
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            if let error = items.first(where: { $0.name == "error" })?.value { store.report(error) }
            await store.refreshAccounts()
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            return
        } catch {
            store.report(error.localizedDescription)
        }
    }
}

struct ESPNDraft: Identifiable {
    let id = UUID()
    var originalID: String?
    var leagueId = ""
    var teamId = ""
    var isPrivate = false
    var hasSavedCookies = false
    var espnS2 = ""
    var swid = ""

    init() {}
    init(_ league: Accounts.ESPNLeague) {
        originalID = league.leagueId
        leagueId = league.leagueId
        teamId = league.teamId.map(String.init) ?? ""
        isPrivate = league.hasCookies
        hasSavedCookies = league.hasCookies
    }
}

private struct ESPNLeagueForm: View {
    @State var draft: ESPNDraft
    let onSave: (ESPNDraft) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("League ID", text: $draft.leagueId).keyboardType(.numberPad)
                    TextField("Team ID (optional for private leagues)", text: $draft.teamId).keyboardType(.numberPad)
                }
                Section {
                    Toggle("Private league", isOn: $draft.isPrivate)
                    if draft.isPrivate {
                        TextField(draft.hasSavedCookies ? "espn_s2 (saved, leave blank to keep)" : "espn_s2", text: $draft.espnS2, axis: .vertical)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .font(.footnote.monospaced())
                        TextField(draft.hasSavedCookies ? "SWID (saved, leave blank to keep)" : "SWID, like {XXXXXXXX-…}", text: $draft.swid)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .font(.footnote.monospaced())
                    }
                } footer: {
                    if draft.isPrivate {
                        Text("On a computer, sign in at fantasy.espn.com, open the browser's developer tools, and find the espn_s2 and SWID cookies under Storage or Application → Cookies. They last for months; you'll need new ones if you sign out of ESPN.")
                    }
                }
            }
            .navigationTitle(draft.originalID == nil ? "Add ESPN league" : "ESPN league")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(draft) }
                        .disabled(draft.leagueId.trimmingCharacters(in: .whitespaces).isEmpty
                                  || (draft.isPrivate && !draft.hasSavedCookies && (draft.espnS2.isEmpty || draft.swid.isEmpty)))
                }
            }
        }
    }
}

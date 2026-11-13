import ActivityKit
import SwiftUI
import WidgetKit

@main
struct HuddleWidgets: WidgetBundle {
    var body: some Widget {
        ScoresLiveActivity()
    }
}

/// The rotating Live Activity: the latest scoring play, one league's score, or a touchdown,
/// whichever slide the server (or the open app) sent last.
struct ScoresLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ScoresActivityAttributes.self) { context in
            LiveSlideView(slide: context.state)
                .padding(16)
                .opacity(context.isStale ? 0.6 : 1)
                .activityBackgroundTint(Color.black.opacity(0.75))
                .activitySystemActionForegroundColor(.white)
                .environment(\.colorScheme, .dark)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    LiveSlideView(slide: context.state)
                        .padding(.horizontal, 4)
                        .environment(\.colorScheme, .dark)
                }
            } compactLeading: {
                IslandLeading(slide: context.state)
            } compactTrailing: {
                IslandTrailing(slide: context.state)
            } minimal: {
                IslandMinimal(slide: context.state)
            }
            .keylineTint(context.state.kind == .touchdown ? .yellow : .green)
        }
    }
}

#Preview("Play", as: .content, using: ScoresActivityAttributes(week: 10)) {
    ScoresLiveActivity()
} contentStates: {
    LiveSlide(kind: .play, nflTeam: "NYG", player: "Malik Nabers", text: "M. Nabers caught pass for 20 yards", points: 3, leagues: 1, platform: .sleeper, leagueName: "Dynasty Bros")
    LiveSlide(kind: .score, platform: .sleeper, leagueName: "Dynasty Bros", myTeam: "Fat Pat's Donut Shop", myScore: 100.3, opponentTeam: "Team 2", opponentScore: 90.4, leading: "me")
    LiveSlide(kind: .touchdown, nflTeam: "NYG", player: "Malik Nabers", text: "M. Nabers caught pass for 20 yards, touchdown", points: 9, leagues: 2, platform: .espn, leagueName: "Work League & Dynasty Bros")
}

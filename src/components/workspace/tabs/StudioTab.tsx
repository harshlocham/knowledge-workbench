import {
	ResearchStudioPanel,
	type ResearchStudioPanelProps,
} from "#/components/workspace/studio/ResearchStudioPanel.tsx";

export function StudioTab(props: ResearchStudioPanelProps) {
	return (
		<div className="h-full overflow-y-auto p-4">
			<ResearchStudioPanel {...props} />
		</div>
	);
}

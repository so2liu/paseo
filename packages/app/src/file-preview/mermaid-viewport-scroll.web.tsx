import { forwardRef, type ComponentProps } from "react";
import { ScrollView } from "react-native";

type MermaidViewportScrollProps = ComponentProps<typeof ScrollView>;

export const MermaidViewportScroll = forwardRef<ScrollView, MermaidViewportScrollProps>(
  function MermaidViewportScroll(props, ref) {
    return <ScrollView {...props} ref={ref} />;
  },
);

import { ScrollViewStyleReset } from "expo-router/html";
import type { ReactNode } from "react";

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta content="IE=edge" httpEquiv="X-UA-Compatible" />

				{/*
				  This viewport disables scaling, which makes the mobile website act more like a native app.
				  However, this does reduce built-in accessibility. If you want to enable scaling, use this instead:
					<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
				*/}
				<meta
					content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1.00001,viewport-fit=cover"
					name="viewport"
				/>
				{/*
				  Disable body scrolling on the web. This makes ScrollView components work closer to how they do on native.
				  However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
				*/}
				<ScrollViewStyleReset />

				{/* Using raw CSS styles as an escape-hatch to ensure the background color never flickers in dark-mode. */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: CSS styles are safe here */}
				<style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
				<title>React Native</title>
				{/* Add any additional <head> elements that you want globally available on the web... */}
			</head>
			<body>{children}</body>
		</html>
	);
}

const responsiveBackground = `
body {
  background-color: #fff;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #000;
  }
}`;

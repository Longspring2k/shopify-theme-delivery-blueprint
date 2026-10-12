# Engineering decisions

Shopify Theme Delivery Blueprint

## Staging by default

A delivery workflow should target an unpublished theme unless production release has been explicitly approved.

## Platform-native structure

Keep conventions recognizable to other Shopify developers and merchants.

## Honest test coverage

A documented browser-test plan is not the same as an implemented browser suite.

## Reading the architecture

Theme change → Formatting and Theme Check → Manual staging dispatch → Unpublished theme → Separate release review

The diagram reduces the implementation to its relevant responsibilities. It does not expose private endpoints, exact deployment layout, resource identifiers or operational configuration.

# Dashboard

Dashboards are the central feature of Perses—the place where users spend most of their time exploring and understanding observability data. A dashboard brings together multiple visualizations on a single page, allowing you to monitor and investigate data from different sources without repeatedly typing queries. By saving these queries and their visual representations, dashboards make investigations faster and more consistent.

A dashboard can be created through the UI or managed [as-code](./dashboard-as-code.md) and it belongs to a [project](./project.md).

A dashboard relies on one or more [datasources](./datasource.md) to fetch its data. Datasources serve as the connection point between Perses and the observability backends.

A dashboard can include [variables](../concepts/variable.md), that allow users to interactively change the query scopes, filter data, or customize dashboard views without modifying the underlying dashboard configuration, making dashboards more flexible and reusable.

A dashboard's visual elements consist of a set of panels. Each panel displays specific data in the form of charts, tables, or other visualization types, allowing users to quickly interpret metrics, traces, logs or profiles. Panels are plugged to the datasources via their configured queries, which are written in the relevant datasource’s query language and specify the exact data to retrieve from this datasource. These queries can also make use of the configured variables to allow dynamic query scope for the end user.

The structured format of Perses dashboards is designed to provide an [open, standardized specification](./open-specification.md) that fosters interoperability across observability tools and serves as a solid foundation for managing dashboards as code.

Perses also supports [migration](../migration.md) from Grafana dashboards to its own data model, making it easy to onboard and reuse existing visualizations without starting from scratch.

## Using a dashboard as home page

By default, Perses opens on a home page that lists the projects, the recently viewed dashboards and the important dashboards. Each user can choose to display one of the dashboards they have access to instead:

1. Open your profile with the `G` then `P` keyboard shortcut, or from the account menu when the authentication is enabled, and select the **Preferences** section.
2. Under **Home page**, select the project and the dashboard to display.
3. Click on **Save**.

Going to the home page now opens the selected dashboard. To display the default home page again, click on **Use default home page** in the same section.

This preference is stored in the browser, so it applies to this browser only. When the selected dashboard cannot be loaded, for example because it has been deleted, the default home page is displayed instead.

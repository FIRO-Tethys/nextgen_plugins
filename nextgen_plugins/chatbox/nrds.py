from intake.source import base
import os
import asyncio
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BUCKET = "ciroh-community-ngen-datastream"
OUTPUTS_DIR = "outputs"
PREFIX_HYDROFABRIC = "v2.2_hydrofabric"
NGEN_RUN_PREFIX = "ngen-run/outputs/troute"


class NRDSDataSource(base.DataSource):
    container = "python"
    version = "0.0.1"
    name = "nrds_s3"
    visualization_tags = [
        "national",
        "water",
        "model",
        "nextgen",
        "nrds",
        "time series",
        "ensemble",
    ]
    visualization_description = "Time series visualization for the NRDS s3 bucket"
    visualization_args = {
        "data": "text",
    }
    visualization_group = "NextGen",
    visualization_label = "NextGen Time Series"
    visualization_type = "plotly"

    def __init__(self, data, metadata=None):
        self.bucket = BUCKET
        self.outputs_dir = OUTPUTS_DIR
        self.prefix_hydrofabric = PREFIX_HYDROFABRIC
        self.ngen_run_prefix = NGEN_RUN_PREFIX
        self.data = data
        super(NRDSDataSource, self).__init__(metadata=metadata)

    def read(self):
        self.metadata =(self.bucket)
        if self.metadata is not None:
            self.parseData()
        traces = self.create_plotly_data()
        layout = self.create_plotly_layout()
        return {"data": traces, "layout": layout}

    def create_plotly_data(self):
        """
        Process the data object to create a list of traces for Plotly.js.
        """
        traces = []
        x = self.data.x
        y = self.data.y
        trace = {
            "x": x,
            "y": y,
            "type": "scatter",
            "mode": "lines",
            "name": "Time Series",
            "line": {"width": 2},
        }
        traces.append(trace)

        return traces

    def create_plotly_layout(self, yaxis_title="Flow"):
        """
        Create a layout dictionary for Plotly.js based on the data object.
        """
        units = None
        if units:
            yaxis_title_with_units = f"{yaxis_title} ({units})"
        else:
            yaxis_title_with_units = yaxis_title

        layout = {
            "title": "<b>Reach</b>: {} <br><sub>ID:{} </sub>".format(
                self.metadata.get("name", "Unknown"), self.id
            ),
            "xaxis": {
                "type": "date",
                "tickformat": "%Y-%m-%d\n%H:%M",
            },
            "yaxis": {
                "title": {"text": yaxis_title_with_units},
                "rangemode": "tozero",
            },
            "legend": {
                "orientation": "h",
                "x": 0,
                "y": -0.2,
            },
            "margin": {
                "l": 50,
                "r": 50,
                "t": 80,
                "b": 80,
            },
            "hovermode": "x unified",
        }

        return layout


    def parseData(self):
        try:
            print("Parsing data for bucket: {}".format(self.bucket))
            print(self.data)
        except Exception as e:
                logger.error(e)
                return None
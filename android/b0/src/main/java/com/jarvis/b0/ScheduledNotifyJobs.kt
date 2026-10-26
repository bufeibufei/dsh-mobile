package com.jarvis.b0

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/** Platform scheduler avoids adding an offline-unverified WorkManager dependency graph. */
internal object ScheduledNotifyJobs {
    private const val PERIODIC = 4201
    private const val SYNC = 4202
    private const val DAILY = 4203
    fun periodic(context: Context) {
        val manager = context.getSystemService(JobScheduler::class.java)
        if (manager.getPendingJob(PERIODIC) != null) return
        manager.schedule(builder(context, PERIODIC).setPeriodic(60 * 60 * 1000L).setPersisted(true).build())
    }
    fun once(context: Context, daily: Boolean = false) {
        val info = builder(context, if (daily) DAILY else SYNC)
        context.getSystemService(JobScheduler::class.java).schedule(info.build())
    }
    private fun builder(context: Context, id: Int) =
        JobInfo.Builder(id, ComponentName(context, ScheduledNotifyJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
    fun cancel(context: Context) {
        val manager = context.getSystemService(JobScheduler::class.java)
        listOf(PERIODIC, SYNC, DAILY).forEach(manager::cancel)
    }
}

class ScheduledNotifyJobService : JobService() {
    private val running = mutableSetOf<JobParameters>()
    override fun onStartJob(params: JobParameters): Boolean {
        running.add(params)
        ScheduledNotifySync.get(this).background {
            if (running.remove(params)) jobFinished(params, false)
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean {
        running.remove(params)
        return false
    }
}
